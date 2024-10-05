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

  set(key: string, value: IData, ttl = Number.POSITIVE_INFINITY): void {
    this.#cache.set(key, {
      value,
      expiresAt: Date.now() + ttl,
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
