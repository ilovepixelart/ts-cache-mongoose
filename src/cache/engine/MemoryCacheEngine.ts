import { serialize } from 'node:v8'
import { ms } from '../../ms'

import type { CacheData, CacheEngine, Duration } from '../../types'

type Entry = { value: CacheData; expiresAt: number; bytes: number }

export type MemoryCacheEngineOptions = {
  maxEntries?: number | undefined
  maxBytes?: number | undefined
  sizeCalculation?: ((value: CacheData) => number) | undefined
}

// Default sizer: v8.serialize handles circular references (mongoose
// populate results sometimes carry parent back-refs), works in Node /
// Bun / Deno, and does the walk in a single C++ call. Consumers can
// override with `sizeCalculation` when they know their payload shape
// well enough to return an O(1) estimate.
const defaultSizer = (value: CacheData): number => serialize(value).byteLength

export class MemoryCacheEngine implements CacheEngine {
  readonly #cache: Map<string, Entry>
  readonly #maxEntries: number
  readonly #maxBytes: number
  readonly #sizeOf: (value: CacheData) => number
  #totalBytes: number

  constructor(options?: MemoryCacheEngineOptions) {
    this.#cache = new Map()
    this.#maxEntries = options?.maxEntries != null && options.maxEntries > 0 ? options.maxEntries : Number.POSITIVE_INFINITY
    this.#maxBytes = options?.maxBytes != null && options.maxBytes > 0 ? options.maxBytes : Number.POSITIVE_INFINITY
    this.#sizeOf = options?.sizeCalculation ?? defaultSizer
    this.#totalBytes = 0
  }

  get totalBytes(): number {
    return this.#totalBytes
  }

  get size(): number {
    return this.#cache.size
  }

  get(key: string): CacheData {
    const item = this.#cache.get(key)
    if (!item) return undefined
    if (item.expiresAt < Date.now()) {
      this.#cache.delete(key)
      this.#totalBytes -= item.bytes
      return undefined
    }
    // LRU touch: move entry to the end of insertion order so recently
    // read keys outlive stale ones under eviction pressure.
    this.#cache.delete(key)
    this.#cache.set(key, item)
    return item.value
  }

  set(key: string, value: CacheData, ttl?: Duration): void {
    const givenTTL = ttl == null ? undefined : ms(ttl)
    const actualTTL = givenTTL ?? Number.POSITIVE_INFINITY

    const existing = this.#cache.get(key)
    if (existing) {
      this.#cache.delete(key)
      this.#totalBytes -= existing.bytes
    }

    const bytes = this.#sizeOf(value)
    this.#cache.set(key, { value, expiresAt: Date.now() + actualTTL, bytes })
    this.#totalBytes += bytes

    // Soft cap: the just-written entry is never evicted. If either
    // bound is exceeded, drop LRU entries until both are satisfied or
    // only the new entry remains.
    while ((this.#cache.size > this.#maxEntries || this.#totalBytes > this.#maxBytes) && this.#cache.size > 1) {
      const oldestKey = this.#cache.keys().next().value
      if (oldestKey === undefined || oldestKey === key) break
      const oldest = this.#cache.get(oldestKey)
      this.#cache.delete(oldestKey)
      if (oldest) this.#totalBytes -= oldest.bytes
    }
  }

  del(key: string): void {
    const item = this.#cache.get(key)
    if (!item) return
    this.#cache.delete(key)
    this.#totalBytes -= item.bytes
  }

  clear(): void {
    this.#cache.clear()
    this.#totalBytes = 0
  }

  close(): void {
    // do nothing
  }
}
