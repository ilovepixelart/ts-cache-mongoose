import { Cache } from './cache/Cache'
import { extendAggregate } from './extend/aggregate'
import { extendQuery } from './extend/query'

import type { Mongoose } from 'mongoose'
import type { CacheOptions, Duration } from './types'

export * from './types'

declare module 'mongoose' {
  interface Query<ResultType, DocType, THelpers, RawDocType> {
    cache: (this: Query<ResultType, DocType, THelpers, RawDocType>, ttl?: Duration, customKey?: string) => this
    _key: string | null
    getCacheKey: (this: Query<ResultType, DocType, THelpers, RawDocType>) => string
    _ttl: Duration | null
    getDuration: (this: Query<ResultType, DocType, THelpers, RawDocType>) => Duration | null
    op?: string
    _path?: unknown
    _fields?: unknown
    _distinct?: unknown
    _conditions?: unknown
  }

  interface Aggregate<ResultType> {
    cache: (this: Aggregate<ResultType>, ttl?: Duration, customKey?: string) => this
    _key: string | null
    getCacheKey: (this: Aggregate<ResultType>) => string
    _ttl: Duration | null
    getDuration: (this: Aggregate<ResultType>) => Duration | null
  }
}

class CacheMongoose {
  static #instance: CacheMongoose | undefined
  private cache!: Cache

  private constructor() {
    // Private constructor to prevent external instantiation
  }

  public static init(mongoose: Mongoose, cacheOptions: CacheOptions): CacheMongoose {
    if (!CacheMongoose.#instance) {
      CacheMongoose.#instance = new CacheMongoose()
      CacheMongoose.#instance.cache = new Cache(cacheOptions)

      const cache = CacheMongoose.#instance.cache

      extendQuery(mongoose, cache)
      extendAggregate(mongoose, cache)
    }

    return CacheMongoose.#instance
  }

  public async clear(customKey?: string): Promise<void> {
    if (customKey == null) {
      await this.cache.clear()
    } else {
      await this.cache.del(customKey)
    }
  }

  public async close(): Promise<void> {
    await this.cache.close()
  }
}

export default CacheMongoose
