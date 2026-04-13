import { EJSON } from 'bson'
import IORedis from 'ioredis'
import { ms } from '../../ms'
import { convertToObject } from '../../version'

import type { Redis, RedisOptions } from 'ioredis'
import type { CacheData, CacheEngine, Duration } from '../../types'

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
        // reject undefined input — so skip the write entirely.
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
    await this.#client.flushdb()
  }

  async close(): Promise<void> {
    await this.#client.quit()
  }
}
