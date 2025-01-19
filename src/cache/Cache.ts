import ms from 'ms'

import MemoryCacheEngine from './engine/MemoryCacheEngine'
import RedisCacheEngine from './engine/RedisCacheEngine'

import type { StringValue } from 'ms'
import type ICacheEngine from '../interfaces/ICacheEngine'
import type ICacheOptions from '../interfaces/ICacheOptions'
import type IData from '../interfaces/IData'

class CacheEngine {
  #engine!: ICacheEngine
  #defaultTTL: number
  #debug: boolean
  readonly #engines = ['memory', 'redis'] as const

  constructor(cacheOptions: ICacheOptions) {
    if (!this.#engines.includes(cacheOptions.engine)) {
      throw new Error(`Invalid engine name: ${cacheOptions.engine}`)
    }

    if (cacheOptions.engine === 'redis' && !cacheOptions.engineOptions) {
      throw new Error(`Engine options are required for ${cacheOptions.engine} engine`)
    }

    if (!cacheOptions.defaultTTL) {
      cacheOptions.defaultTTL = '1 minute'
    }

    this.#defaultTTL = typeof cacheOptions.defaultTTL === 'string' ? ms(cacheOptions.defaultTTL) : cacheOptions.defaultTTL

    if (cacheOptions.engine === 'redis' && cacheOptions.engineOptions) {
      this.#engine = new RedisCacheEngine(cacheOptions.engineOptions)
    }

    if (cacheOptions.engine === 'memory') {
      this.#engine = new MemoryCacheEngine()
    }

    this.#debug = cacheOptions.debug === true
  }

  async get(key: string): Promise<IData> {
    const cacheEntry = await this.#engine.get(key)
    if (this.#debug) {
      const cacheHit = cacheEntry != null ? 'HIT' : 'MISS'
      console.log(`[ts-cache-mongoose] GET '${key}' - ${cacheHit}`)
    }
    return cacheEntry
  }

  async set(key: string, value: IData, ttl: number | StringValue | null): Promise<void> {
    const givenTTL = typeof ttl === 'string' ? ms(ttl) : ttl
    const actualTTL = givenTTL ?? this.#defaultTTL
    await this.#engine.set(key, value, actualTTL)
    if (this.#debug) {
      console.log(`[ts-cache-mongoose] SET '${key}' - ttl: ${actualTTL.toFixed(0)} ms`)
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
      console.log('[ts-cache-mongoose] CLEAR')
    }
  }

  async close(): Promise<void> {
    return this.#engine.close()
  }
}

export default CacheEngine
