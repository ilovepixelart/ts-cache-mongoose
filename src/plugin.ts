import Cache from './cache/Cache'
import extendAggregate from './extend/aggregate'
import extendQuery from './extend/query'

import type { Mongoose } from 'mongoose'
import type ICacheOptions from './interfaces/ICacheOptions'

declare module 'mongoose' {
  interface Query<ResultType, DocType, THelpers, RawDocType> {
    cache: (this: Query<ResultType, DocType, THelpers, RawDocType>, ttl?: string, customKey?: string) => this
    _key: string | null
    getCacheKey: (this: Query<ResultType, DocType, THelpers, RawDocType>) => string
    _ttl: string | null
    getCacheTTL: (this: Query<ResultType, DocType, THelpers, RawDocType>) => string | null
    op?: string
    _path?: unknown
    _fields?: unknown
    _distinct?: unknown
    _conditions?: unknown
  }

  interface Aggregate<ResultType> {
    cache: (this: Aggregate<ResultType>, ttl?: string, customKey?: string) => this
    _key: string | null
    getCacheKey: (this: Aggregate<ResultType>) => string
    _ttl: string | null
    getCacheTTL: (this: Aggregate<ResultType>) => string | null
  }
}

class CacheMongoose {
  static #instance: CacheMongoose | undefined
  private cache!: Cache

  private constructor() {
    // Private constructor to prevent external instantiation
  }

  public static init(mongoose: Mongoose, cacheOptions: ICacheOptions): CacheMongoose {
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
    if (customKey != null) {
      await this.cache.del(customKey)
    } else {
      await this.cache.clear()
    }
  }

  public async close(): Promise<void> {
    await this.cache.close()
  }
}

export default CacheMongoose
