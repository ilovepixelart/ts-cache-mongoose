import Cache from './cache/Cache'

import type { Mongoose } from 'mongoose'
import type ICacheOptions from './interfaces/ICacheOptions'

import extendQuery from './extend/query'
import extendAggregate from './extend/aggregate'

declare module 'mongoose' {
  interface Query<ResultType, DocType, THelpers, RawDocType> {
    cache: (this: Query<ResultType, DocType, THelpers, RawDocType>, ttl?: string, customKey?: string) => this
    _key?: string
    getCacheKey: (this: Query<ResultType, DocType, THelpers, RawDocType>) => string
    _ttl?: string
    getCacheTTL: (this: Query<ResultType, DocType, THelpers, RawDocType>) => string | undefined
    op?: string
    _path?: unknown
    _fields?: unknown
    _distinct?: unknown
    _conditions?: unknown
  }

  interface Aggregate<ResultType> {
    cache: (this: Aggregate<ResultType>, ttl?: string, customKey?: string) => this
    _key?: string
    getCacheKey: (this: Aggregate<ResultType>) => string
    _ttl?: string
    getCacheTTL: (this: Aggregate<ResultType>) => string | undefined
  }
}

class CacheMongoose {
  // eslint-disable-next-line no-use-before-define
  private static instance: CacheMongoose | undefined
  private cache!: Cache

  private constructor () {
    // Private constructor to prevent external instantiation
  }

  public static init (mongoose: Mongoose, cacheOptions: ICacheOptions): CacheMongoose {
    if (!this.instance) {
      this.instance = new CacheMongoose()
      this.instance.cache = new Cache(cacheOptions)

      const cache = this.instance.cache

      extendQuery(mongoose, cache)
      extendAggregate(mongoose, cache)
    }

    return this.instance
  }

  public async clear (customKey?: string): Promise<void> {
    if (typeof customKey === 'string') {
      await this.cache.del(customKey)
    } else {
      await this.cache.clear()
    }
  }

  public async close (): Promise<void> {
    await this.cache.close()
  }
}

export default CacheMongoose
