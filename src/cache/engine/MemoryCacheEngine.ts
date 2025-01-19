import ms from 'ms'

import type { CacheData, CacheEngine, CacheTTL } from '../../types'

export class MemoryCacheEngine implements CacheEngine {
  readonly #cache: Map<string, { value: CacheData; expiresAt: number } | undefined>

  constructor() {
    this.#cache = new Map()
  }

  get(key: string): CacheData {
    const item = this.#cache.get(key)
    if (!item || item.expiresAt < Date.now()) {
      this.del(key)
      return undefined
    }
    return item.value
  }

  set(key: string, value: CacheData, ttl?: CacheTTL): void {
    const givenTTL = typeof ttl === 'string' ? ms(ttl) : ttl
    const actualTTL = givenTTL ?? Number.POSITIVE_INFINITY
    this.#cache.set(key, {
      value,
      expiresAt: Date.now() + actualTTL,
    })
  }

  del(key: string): void {
    this.#cache.delete(key)
  }

  clear(): void {
    this.#cache.clear()
  }

  close(): void {
    // do nothing
  }
}
