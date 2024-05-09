import IORedis from 'ioredis'
import { EJSON } from 'bson'

import { convertToObject } from '../../version'

import type { Redis, RedisOptions } from 'ioredis'
import type IData from '../../interfaces/IData'
import type ICacheEngine from '../../interfaces/ICacheEngine'

class RedisCacheEngine implements ICacheEngine {
  #client: Redis

  constructor(options: RedisOptions) {
    if (!options.keyPrefix) {
      options.keyPrefix = 'cache-mongoose:'
    }
    this.#client = new IORedis(options)
  }

  async get(key: string): Promise<IData> {
    try {
      const value = await this.#client.get(key)
      if (value === null) {
        return undefined
      }
      return EJSON.parse(value) as IData
    } catch (err) {
      console.error(err)
      return undefined
    }
  }

  async set(key: string, value: IData, ttl = Infinity): Promise<void> {
    try {
      const serializedValue = EJSON.stringify(convertToObject(value))
      await this.#client.setex(key, Math.ceil(ttl / 1000), serializedValue)
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

export default RedisCacheEngine
