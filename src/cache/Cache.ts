import { ms } from '../ms'
import { MemoryCacheEngine } from './engine/MemoryCacheEngine'
import { RedisCacheEngine } from './engine/RedisCacheEngine'

import type { CacheData, CacheEngine, CacheOptions, Duration } from '../types'

export class Cache {
  readonly #engine!: CacheEngine
  readonly #defaultTTL: number
  readonly #debug: boolean
  readonly #onError: (error: Error) => void
  readonly #engines = ['memory', 'redis'] as const

  constructor(cacheOptions: CacheOptions) {
    if (!this.#engines.includes(cacheOptions.engine)) {
      throw new Error(`Invalid engine name: ${cacheOptions.engine}`)
    }

    if (cacheOptions.engine === 'redis' && !cacheOptions.engineOptions) {
      throw new Error(`Engine options are required for ${cacheOptions.engine} engine`)
    }

    cacheOptions.defaultTTL ??= '1 minute'

    this.#defaultTTL = ms(cacheOptions.defaultTTL)
    this.#onError = cacheOptions.onError ?? console.error

    if (cacheOptions.engine === 'redis' && cacheOptions.engineOptions) {
      this.#engine = new RedisCacheEngine(cacheOptions.engineOptions, this.#onError)
    }

    if (cacheOptions.engine === 'memory') {
      this.#engine = new MemoryCacheEngine()
    }

    this.#debug = cacheOptions.debug === true
  }

  get onError(): (error: Error) => void {
    return this.#onError
  }

  async get(key: string): Promise<CacheData> {
    const cacheEntry = await this.#engine.get(key)
    if (this.#debug) {
      const cacheHit = cacheEntry == null ? 'MISS' : 'HIT'
      console.log(`[ts-cache-mongoose] GET '${key}' - ${cacheHit}`)
    }
    return cacheEntry
  }

  async set(key: string, value: CacheData, ttl: Duration | null): Promise<void> {
    const givenTTL = ttl == null ? null : ms(ttl)
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
