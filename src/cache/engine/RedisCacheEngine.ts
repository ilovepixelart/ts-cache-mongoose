import IORedis from 'ioredis'

import type { Redis } from 'ioredis'

import type ICacheEngine from '../../interfaces/ICacheEngine'

class RedisCacheEngine implements ICacheEngine {
  private client: Redis

  constructor () {
    this.client = new IORedis()
  }

  async get (key: string): Promise<Record<string, unknown> | Record<string, unknown>[] | undefined> {
    const value = await this.client.get(key)
    if (value === null) {
      return undefined
    }
    return JSON.parse(value) as Promise<Record<string, unknown> | Record<string, unknown>[]>
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
}

export default RedisCacheEngine
