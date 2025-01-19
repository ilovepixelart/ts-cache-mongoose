import type { RedisOptions } from 'ioredis'
import type { StringValue } from 'ms'

export type CacheTTL = number | StringValue

export type CacheData = Record<string, unknown> | Record<string, unknown>[] | unknown[] | number | undefined

export type CacheOptions = {
  engine: 'memory' | 'redis'
  engineOptions?: RedisOptions
  defaultTTL?: CacheTTL
  debug?: boolean
}

export interface CacheEngine {
  get: (key: string) => Promise<CacheData> | CacheData
  set: (key: string, value: CacheData, ttl?: CacheTTL) => Promise<void> | void
  del: (key: string) => Promise<void> | void
  clear: () => Promise<void> | void
  close: () => Promise<void> | void
}
