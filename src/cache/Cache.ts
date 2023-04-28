import ms from 'ms'

import type ICacheEngine from '../interfaces/ICacheEngine'
import type ICacheOptions from '../interfaces/ICacheOptions'

import MemoryCacheEngine from './engine/MemoryCacheEngine'
import RedisCacheEngine from './engine/RedisCacheEngine'

class CacheEngine {
  private engine!: ICacheEngine
  private defaultTTL: number
  private readonly engines = ['memory', 'redis'] as const

  constructor (cacheOptions: ICacheOptions) {
    if (!this.engines.includes(cacheOptions.engine)) {
      throw new Error(`Invalid engine name: ${cacheOptions.engine}`)
    }

    if (cacheOptions.engine === 'redis' && !cacheOptions.engineOptions) {
      throw new Error(`Engine options are required for ${cacheOptions.engine} engine`)
    }

    this.defaultTTL = ms(cacheOptions.defaultTTL ?? '1 minute')

    if (cacheOptions.engine === 'redis' && cacheOptions.engineOptions) {
      this.engine = new RedisCacheEngine(cacheOptions.engineOptions)
    }

    if (cacheOptions.engine === 'memory') {
      this.engine = new MemoryCacheEngine()
    }
  }

  async get (key: string): Promise<Record<string, unknown> | Record<string, unknown>[] | undefined> {
    return this.engine.get(key)
  }

  async set (key: string, value: Record<string, unknown> | Record<string, unknown>[], ttl?: string): Promise<void> {
    const actualTTL = ttl ? ms(ttl) : this.defaultTTL
    return this.engine.set(key, value, actualTTL)
  }

  async del (key: string): Promise<void> {
    return this.engine.del(key)
  }

  async clear (): Promise<void> {
    return this.engine.clear()
  }

  async close (): Promise<void> {
    return this.engine.close()
  }
}

export default CacheEngine
