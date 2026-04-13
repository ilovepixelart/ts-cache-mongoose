import type { RedisOptions } from 'ioredis'
import type { Duration } from './ms'

export type { Duration } from './ms'

export type CacheData = Record<string, unknown> | Record<string, unknown>[] | unknown[] | number | undefined

export type CacheOptions = {
  engine: 'memory' | 'redis'
  engineOptions?: RedisOptions
  defaultTTL?: Duration
  debug?: boolean
  onError?: (error: Error) => void
  maxEntries?: number
  maxBytes?: number
  sizeCalculation?: (value: CacheData) => number
}

export interface CacheEngine {
  get: (key: string) => Promise<CacheData> | CacheData
  set: (key: string, value: CacheData, ttl?: Duration) => Promise<void> | void
  del: (key: string) => Promise<void> | void
  clear: () => Promise<void> | void
  close: () => Promise<void> | void
}
