import IORedis from 'ioredis'
import { EJSON } from 'bson'

import type { Redis, RedisOptions } from 'ioredis'
import type IData from '../../interfaces/IData'
import type ICacheEngine from '../../interfaces/ICacheEngine'
import { convertToObject } from '../../version'

class RedisCacheEngine implements ICacheEngine {
  #client: Redis

  constructor(options: RedisOptions) {
    if (!options.keyPrefix) {
      options.keyPrefix = 'cache-mongoose:'
    }
    this.#client = new IORedis(options)
  }

  async get(key: string): Promise<IData> {
    const value = await this.#client.get(key)
    if (value === null) {
      return undefined
    }
    return EJSON.parse(value) as Promise<Record<string, unknown> | Record<string, unknown>[]>
  }

  async set(key: string, value: IData, ttl = Infinity): Promise<void> {
    const serializedValue = EJSON.stringify(convertToObject(value))
    await this.#client.setex(key, Math.ceil(ttl / 1000), serializedValue)
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

export default RedisCacheEngine
