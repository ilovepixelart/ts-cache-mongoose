import IORedis from 'ioredis'
import { Types } from 'mongoose'

import type { Redis, RedisOptions } from 'ioredis'
import type IData from '../../interfaces/IData'
import type ICacheEngine from '../../interfaces/ICacheEngine'

class RedisCacheEngine implements ICacheEngine {
  private client: Redis

  constructor (options: RedisOptions) {
    if (!options.keyPrefix) {
      options.keyPrefix = 'cache-mongoose:'
    }
    this.client = new IORedis(options)
  }

  async get (key: string): Promise<IData> {
    const value = await this.client.get(key)
    if (value === null) {
      return undefined
    }
    return JSON.parse(value, (_, value) => {
      if (typeof value === 'string') {
        const dateRegex = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/
        if (dateRegex.test(value)) {
          return new Date(value)
        } else if (Types.ObjectId.isValid(value)) {
          const oId = new Types.ObjectId(value)
          return oId.toString() === value ? oId : value
        }
      }
      return value as unknown
    }) as Promise<Record<string, unknown> | Record<string, unknown>[]>
  }

  async set (key: string, value: unknown, ttl = Infinity): Promise<void> {
    const serializedValue = JSON.stringify(value)
    await this.client.setex(key, Math.ceil(ttl / 1000), serializedValue)
  }

  async del (key: string): Promise<void> {
    await this.client.del(key)
  }

  async clear (): Promise<void> {
    await this.client.flushdb()
  }

  async close (): Promise<void> {
    await this.client.quit()
  }
}

export default RedisCacheEngine
