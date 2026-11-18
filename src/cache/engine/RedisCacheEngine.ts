import IORedis from 'ioredis'
import mongoose from 'mongoose'
import { ms } from '../../ms'
import { convertToObject } from '../../version'

import type { EJSON as EJSONType } from 'bson'
import type { Redis, RedisOptions } from 'ioredis'
import type { CacheData, CacheEngine, Duration } from '../../types'

// The driver's EJSON, so a hit holds the BSON classes the driver returns (mongoose.Types.ObjectId
// and the like) rather than those of another copy of the bson package. `mongo.BSON` exists from
// mongoose 6 on, though mongoose 6's types omit it.
const { EJSON } = (mongoose.mongo as unknown as { BSON: { EJSON: typeof EJSONType } }).BSON

// How long commands issued while the first connection is being established wait for it: long
// enough for a reachable Redis to finish its handshake, short enough not to stall a query
// against one that never answers.
const FIRST_CONNECTION_WAIT_MS = 1000

const CONNECTING = new Set(['wait', 'connecting', 'connect'])

const firstConnection = (client: Redis): Promise<void> => {
  if (!CONNECTING.has(client.status)) return Promise.resolve()
  return new Promise((resolve) => {
    const done = () => {
      clearTimeout(timer)
      client.off('ready', done).off('close', done)
      resolve()
    }
    const timer = setTimeout(done, FIRST_CONNECTION_WAIT_MS)
    timer.unref()
    client.once('ready', done).once('close', done)
    if (client.status === 'wait') client.connect().catch(() => {})
  })
}

export class RedisCacheEngine implements CacheEngine {
  readonly #client: Redis
  readonly #onError: (error: Error) => void
  #firstConnection: Promise<void> | undefined

  constructor(options: RedisOptions, onError: (error: Error) => void) {
    options.keyPrefix ??= 'cache-mongoose:'
    // A command that finds the connection down fails at once instead of waiting in the offline
    // queue through reconnection attempts, so the query falls through to MongoDB. Options set
    // explicitly in engineOptions win; `maxRetriesPerRequest: null` is an explicit value.
    this.#client = new IORedis({
      ...options,
      enableOfflineQueue: options.enableOfflineQueue ?? false,
      maxRetriesPerRequest: options.maxRetriesPerRequest === undefined ? 0 : options.maxRetriesPerRequest,
    })
    this.#onError = onError
    if (options.enableOfflineQueue !== undefined) this.#firstConnection = Promise.resolve()
  }

  #connected(): Promise<void> {
    this.#firstConnection ??= firstConnection(this.#client)
    return this.#firstConnection
  }

  async get(key: string): Promise<CacheData> {
    try {
      await this.#connected()
      const value = await this.#client.get(key)
      if (value === null) {
        return undefined
      }
      return EJSON.parse(value) as CacheData
    } catch (err) {
      this.#onError(err as Error)
      return undefined
    }
  }

  async set(key: string, value: CacheData, ttl?: Duration): Promise<void> {
    try {
      await this.#connected()
      const converted = convertToObject(value)
      if (converted === undefined) {
        // Nothing to cache. Redis has no distinct representation of
        // "undefined" vs "not set", and bson 7's EJSON.stringify types
        // reject undefined input, so skip the write entirely.
        return
      }
      const givenTTL = ttl == null ? undefined : ms(ttl)
      const actualTTL = givenTTL ?? Number.POSITIVE_INFINITY
      const serializedValue = EJSON.stringify(converted)
      await this.#client.setex(key, Math.ceil(actualTTL / 1000), serializedValue)
    } catch (err) {
      this.#onError(err as Error)
    }
  }

  async del(key: string): Promise<void> {
    await this.#connected()
    await this.#client.del(key)
  }

  async clear(): Promise<void> {
    await this.#connected()
    // ioredis prefixes command keys but not SCAN patterns, and SCAN returns full key
    // names, so the prefix goes into the pattern by hand and comes off before UNLINK.
    const prefix = this.#client.options.keyPrefix ?? ''
    const escapedPrefix = prefix.replaceAll(/[*?[\]\\]/g, String.raw`\$&`)
    const match = `${escapedPrefix}*`
    for await (const keys of this.#client.scanStream({ match, count: 500 }) as AsyncIterable<string[]>) {
      if (keys.length > 0) {
        await this.#client.unlink(...keys.map((key) => key.slice(prefix.length)))
      }
    }
  }

  async close(): Promise<void> {
    // QUIT cannot be queued without the offline queue; while disconnected, disconnect() is what
    // ioredis itself does for QUIT with an empty offline queue.
    if (this.#client.status !== 'ready' && !this.#client.options.enableOfflineQueue) {
      this.#client.disconnect()
      return
    }
    // QUIT resolves on the server's reply, before the socket has closed; waiting for `end` keeps a
    // command issued right after close() from finding a half-closed stream.
    const ended = this.#client.status === 'ready' ? new Promise((resolve) => this.#client.once('end', resolve)) : undefined
    await this.#client.quit()
    await ended
  }
}
