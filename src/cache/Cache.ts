import ms from 'ms'

import type IData from '../interfaces/IData'
import type ICacheEngine from '../interfaces/ICacheEngine'
import type ICacheOptions from '../interfaces/ICacheOptions'

import MemoryCacheEngine from './engine/MemoryCacheEngine'
import RedisCacheEngine from './engine/RedisCacheEngine'

class CacheEngine {
  #engine!: ICacheEngine
  #defaultTTL: number
  #debug: boolean;
  readonly #engines = ['memory', 'redis'] as const

  constructor(cacheOptions: ICacheOptions) {
    if (!this.#engines.includes(cacheOptions.engine)) {
      throw new Error(`Invalid engine name: ${cacheOptions.engine}`)
    }

    if (cacheOptions.engine === 'redis' && !cacheOptions.engineOptions) {
      throw new Error(`Engine options are required for ${cacheOptions.engine} engine`)
    }

    this.#defaultTTL = ms(cacheOptions.defaultTTL ?? '1 minute')

    if (cacheOptions.engine === 'redis' && cacheOptions.engineOptions) {
      this.#engine = new RedisCacheEngine(cacheOptions.engineOptions)
    }

    if (cacheOptions.engine === 'memory') {
      this.#engine = new MemoryCacheEngine()
    }

    this.#debug = (cacheOptions.debug === true) ?? false
  }

  async get(key: string): Promise<IData> {
    const cacheEntry = await this.#engine.get(key)
    if (this.#debug) {
      const cacheHit = (cacheEntry != undefined) ? "HIT" : "MISS"
      console.log(`[ts-cache-mongoose] GET '${key}' - ${cacheHit}`)
    }
    return cacheEntry
  }

  async set(key: string, value: Record<string, unknown> | Record<string, unknown>[], ttl: string | null): Promise<void> {
    const actualTTL = ttl ? ms(ttl) : this.#defaultTTL
    await this.#engine.set(key, value, actualTTL)
    if (this.#debug) {
      console.log(`[ts-cache-mongoose] SET '${key}' - ttl: ${actualTTL} ms`)
    }
    
  }

  async del(key: string): Promise<void> {
    await this.#engine.del(key)
    if (this.#debug) {
      console.log(`[ts-cache-mongoose] DEL '${key}'`)
    }
  }

  async clear(): Promise<void> {
    await this.#engine.clear()
    if (this.#debug) {
      console.log(`[ts-cache-mongoose] CLEAR`)
    }
  }

  async close(): Promise<void> {
    return this.#engine.close()
  }
}

export default CacheEngine
