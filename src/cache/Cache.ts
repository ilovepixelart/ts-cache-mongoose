import { ms } from '../ms'
import { MemoryCacheEngine } from './engine/MemoryCacheEngine'
import { RedisCacheEngine } from './engine/RedisCacheEngine'

import type { CacheData, CacheEngine, CacheOptions, Duration } from '../types'

export class Cache {
  readonly #engine!: CacheEngine
  readonly #defaultTTL: number
  readonly #debug: boolean
  readonly #onError: (error: Error) => void
  readonly #coalesce: boolean
  readonly #pending = new Map<string, Promise<CacheData>>()
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
      this.#engine = new MemoryCacheEngine({
        maxEntries: cacheOptions.maxEntries,
        maxBytes: cacheOptions.maxBytes,
        sizeCalculation: cacheOptions.sizeCalculation,
      })
    }

    this.#debug = cacheOptions.debug === true
    this.#coalesce = cacheOptions.coalesce !== false
  }

  get onError(): (error: Error) => void {
    return this.#onError
  }

  /** The load of `key` a concurrent caller started and that has not settled yet. */
  pending(key: string): Promise<CacheData> | undefined {
    return this.#pending.get(key)
  }

  /** Makes `load` the pending load of `key` until it settles, unless coalescing is off. */
  share(key: string, load: Promise<CacheData>): void {
    const settle = () => {
      if (this.#pending.get(key) === load) this.#pending.delete(key)
    }
    // Marks a rejection of `load` as handled whether or not it is shared: the caller that started
    // it receives the error, and an unhandled rejection would end the process.
    load.then(settle, settle)
    if (this.#coalesce) this.#pending.set(key, load)
  }

  async get(key: string): Promise<CacheData> {
    const cacheEntry = await this.#engine.get(key)
    if (this.#debug) {
      const cacheHit = cacheEntry === undefined ? 'MISS' : 'HIT'
      console.log(`[ts-cache-mongoose] GET '${key}' - ${cacheHit}`)
    }
    return cacheEntry
  }

  async set(key: string, value: CacheData, ttl: Duration | null): Promise<void> {
    const givenTTL = ttl == null ? null : ms(ttl)
    const actualTTL = givenTTL ?? this.#defaultTTL
    if (Number.isNaN(actualTTL) || actualTTL <= 0) {
      if (this.#debug) {
        console.log(`[ts-cache-mongoose] SET '${key}' - skipped (non-positive ttl: ${String(actualTTL)} ms)`)
      }
      return
    }
    await this.#engine.set(key, value, actualTTL)
    if (this.#debug) {
      console.log(`[ts-cache-mongoose] SET '${key}' - ttl: ${actualTTL.toFixed(0)} ms`)
    }
  }

  // A load already in flight may have read the data before the change that prompted the
  // invalidation, so later callers no longer join it.
  async del(key: string): Promise<void> {
    this.#pending.delete(key)
    await this.#engine.del(key)
    if (this.#debug) {
      console.log(`[ts-cache-mongoose] DEL '${key}'`)
    }
  }

  async clear(): Promise<void> {
    this.#pending.clear()
    await this.#engine.clear()
    if (this.#debug) {
      console.log('[ts-cache-mongoose] CLEAR')
    }
  }

  async close(): Promise<void> {
    return this.#engine.close()
  }
}
