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

export class RedisCacheEngine implements CacheEngine {
  readonly #client: Redis
  readonly #onError: (error: Error) => void

  constructor(options: RedisOptions, onError: (error: Error) => void) {
    options.keyPrefix ??= 'cache-mongoose:'
    this.#client = new IORedis(options)
    this.#onError = onError
  }

  async get(key: string): Promise<CacheData> {
    try {
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
    await this.#client.del(key)
  }

  async clear(): Promise<void> {
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
    await this.#client.quit()
  }
}
