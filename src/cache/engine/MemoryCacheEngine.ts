import type IData from '../../interfaces/IData'
import type ICacheEngine from '../../interfaces/ICacheEngine'

class MemoryCacheEngine implements ICacheEngine {
  private cache: Record<string, { value: IData, expiresAt: number } | undefined>

  constructor () {
    this.cache = {}
  }

  get (key: string): IData {
    const item = this.cache[key]
    if (!item || item.expiresAt < Date.now()) {
      this.del(key)
      return undefined
    }
    return item.value
  }

  set (key: string, value: IData, ttl = Infinity): void {
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
