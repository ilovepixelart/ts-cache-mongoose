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

// Callers own what they pass in and what they get back, so the engine keeps its own copy of
// the data and hands out a fresh one on every read. Class instances are shared, not copied:
// BSON values (ObjectId, Decimal128, Binary, UUID) are immutable in practice, and a live
// mongoose document has no copy that `Model.hydrate()` reads back the same on every version.
// The walk uses its own stack rather than recursion, so depth is bounded by memory, not by
// the call stack. An array, object or Map reached twice (a cycle, a shared reference) is
// copied once and shared the same way in the copy.
type Container = unknown[] | Record<string, unknown> | Map<unknown, unknown>

const isPlainObject = (value: object): value is Record<string, unknown> => {
  const proto: unknown = Object.getPrototypeOf(value)
  return proto === Object.prototype || proto === null
}

const isContainer = (value: object): value is Container => Array.isArray(value) || isPlainObject(value) || value instanceof Map

const emptyOf = (value: Container): Container => {
  if (Array.isArray(value)) return new Array(value.length)
  if (value instanceof Map) return new Map()
  return Object.getPrototypeOf(value) === null ? Object.create(null) : {}
}

const leafOf = (value: object): unknown => {
  if (value instanceof Date) return new Date(value.getTime())
  if (Buffer.isBuffer(value)) return Buffer.from(value)
  return value
}

const fill = (source: Container, target: Container, visit: (value: unknown) => unknown): void => {
  if (Array.isArray(source)) {
    const items = target as unknown[]
    for (let i = 0; i < source.length; i++) items[i] = visit(source[i])
  } else if (source instanceof Map) {
    for (const [key, item] of source) (target as Map<unknown, unknown>).set(key, visit(item))
  } else {
    const copy = target as Record<string, unknown>
    for (const key of Object.keys(source)) {
      const item = visit(source[key])
      // Plain assignment of "__proto__" would replace the prototype instead of adding the key.
      if (key === '__proto__') Object.defineProperty(copy, key, { value: item, writable: true, enumerable: true, configurable: true })
      else copy[key] = item
    }
  }
}

const copyOf = (root: unknown): unknown => {
  const copies = new Map<Container, Container>()
  const pending: Container[] = []
  const visit = (value: unknown): unknown => {
    if (value === null || typeof value !== 'object') return value
    if (!isContainer(value)) return leafOf(value)
    let copy = copies.get(value)
    if (copy === undefined) {
      copy = emptyOf(value)
      copies.set(value, copy)
      pending.push(value, copy)
    }
    return copy
  }
  const copy = visit(root)
  while (pending.length > 0) {
    const target = pending.pop() as Container
    fill(pending.pop() as Container, target, visit)
  }
  return copy
}

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
    return copyOf(item.value) as CacheData
  }

  set(key: string, value: CacheData, ttl?: Duration): void {
    const givenTTL = ttl == null ? undefined : ms(ttl)
    const actualTTL = givenTTL ?? Number.POSITIVE_INFINITY

    const stored = copyOf(value) as CacheData

    const existing = this.#cache.get(key)
    if (existing) {
      this.#cache.delete(key)
      this.#totalBytes -= existing.bytes
    }

    const bytes = this.#sizeOf(value)
    this.#cache.set(key, { value: stored, expiresAt: Date.now() + actualTTL, bytes })
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
