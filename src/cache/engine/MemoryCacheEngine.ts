import ms from 'ms'

import type { StringValue } from 'ms'
import type ICacheEngine from '../../interfaces/ICacheEngine'
import type IData from '../../interfaces/IData'

class MemoryCacheEngine implements ICacheEngine {
  #cache: Map<string, { value: IData; expiresAt: number } | undefined>

  constructor() {
    this.#cache = new Map()
  }

  get(key: string): IData {
    const item = this.#cache.get(key)
    if (!item || item.expiresAt < Date.now()) {
      this.del(key)
      return undefined
    }
    return item.value
  }

  set(key: string, value: IData, ttl?: number | StringValue): void {
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

export default MemoryCacheEngine
