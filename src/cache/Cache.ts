import ms from 'ms'

import type ICacheEngine from '../interfaces/ICacheEngine'

import MemoryCacheEngine from './engine/MemoryCacheEngine'
import RedisCacheEngine from './engine/RedisCacheEngine'

export const engines = ['memory', 'redis'] as const

class Cache {
  private engine: ICacheEngine
  private defaultTTL: number

  constructor (engineName: 'memory' | 'redis', defaultTTL: string) {
    if (!engines.includes(engineName)) {
      throw new Error(`Invalid engine name: ${engineName}`)
    }

    this.defaultTTL = ms(defaultTTL)

    if (engineName === 'redis') {
      this.engine = new RedisCacheEngine()
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
}

export default Cache
