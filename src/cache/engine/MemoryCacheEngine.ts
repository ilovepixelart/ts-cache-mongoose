import type ICacheEngine from '../../interfaces/ICacheEngine'

class MemoryCacheEngine implements ICacheEngine {
  private cache: Record<string, { value: Record<string, unknown> | Record<string, unknown>[], expiresAt: number } | undefined>

  constructor () {
    this.cache = {}
  }

  get (key: string): Record<string, unknown> | Record<string, unknown>[] | undefined {
    const item = this.cache[key]
    if (!item || item.expiresAt < Date.now()) {
      this.del(key)
      return undefined
    }
    return item.value
  }

  set (key: string, value: Record<string, unknown> | Record<string, unknown>[], ttl = Infinity): void {
    this.cache[key] = { value, expiresAt: Date.now() + ttl }
  }

  del (key: string): void {
    // eslint-disable-next-line @typescript-eslint/no-dynamic-delete
    delete this.cache[key]
  }

  clear (): void {
    this.cache = {}
  }

  close (): void {
    // do nothing
  }
}

export default MemoryCacheEngine
