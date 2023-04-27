import ms from 'ms'

import type ICacheEngine from '../interfaces/ICacheEngine'
import type ICacheOptions from '../interfaces/ICacheOptions'

import MemoryCacheEngine from './engine/MemoryCacheEngine'
import RedisCacheEngine from './engine/RedisCacheEngine'

export const engines = ['memory', 'redis'] as const

class CacheEngine {
  private engine: ICacheEngine
  private defaultTTL: number

  constructor (cacheOptions: ICacheOptions) {
    if (!engines.includes(cacheOptions.engine)) {
      throw new Error(`Invalid engine name: ${cacheOptions.engine}`)
    }

    if (cacheOptions.engine === 'redis' && !cacheOptions.engineOptions) {
      throw new Error(`Engine options are required for ${cacheOptions.engine} engine`)
    }

    this.defaultTTL = ms(cacheOptions.defaultTTL ?? '1 minute')

    if (cacheOptions.engine === 'redis') {
      this.engine = new RedisCacheEngine(cacheOptions.engineOptions ?? {})
    } else {
      this.engine = new MemoryCacheEngine()
    }
  }

  async get (key: string): Promise<Record<string, unknown> | Record<string, unknown>[] | undefined> {
    return await this.engine.get(key)
  }

  async set (key: string, value: Record<string, unknown> | Record<string, unknown>[], ttl?: number): Promise<void> {
    const actualTTL = ttl ?? this.defaultTTL
    return await this.engine.set(key, value, actualTTL)
  }

  async del (key: string): Promise<void> {
    return await this.engine.del(key)
  }

  async clear (): Promise<void> {
    return await this.engine.clear()
  }

  async close (): Promise<void> {
    return await this.engine.close()
  }
}

export default CacheEngine
