import { EJSON } from 'bson'
import IORedis from 'ioredis'
import ms from 'ms'
import { convertToObject } from '../../version'

import type { Redis, RedisOptions } from 'ioredis'
import type { CacheData, CacheEngine, CacheTTL } from '../../types'

export class RedisCacheEngine implements CacheEngine {
  readonly #client: Redis

  constructor(options: RedisOptions) {
    options.keyPrefix ??= 'cache-mongoose:'
    this.#client = new IORedis(options)
  }

  async get(key: string): Promise<CacheData> {
    try {
      const value = await this.#client.get(key)
      if (value === null) {
        return undefined
      }
      return EJSON.parse(value) as CacheData
    } catch (err) {
      console.error(err)
      return undefined
    }
  }

  async set(key: string, value: CacheData, ttl?: CacheTTL): Promise<void> {
    try {
      const givenTTL = typeof ttl === 'string' ? ms(ttl) : ttl
      const actualTTL = givenTTL ?? Number.POSITIVE_INFINITY
      const serializedValue = EJSON.stringify(convertToObject(value))
      await this.#client.setex(key, Math.ceil(actualTTL / 1000), serializedValue)
    } catch (err) {
      console.error(err)
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
