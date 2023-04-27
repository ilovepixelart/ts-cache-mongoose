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
    _fields?: unknown
    _path?: unknown
    _distinct?: unknown
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
  private cacheOptions!: ICacheOptions

  private constructor () {
    // Private constructor to prevent external instantiation
  }

  public static init (mongoose: Mongoose, cacheOptions: ICacheOptions): CacheMongoose {
    if (typeof mongoose.Model.hydrate !== 'function') throw new Error('Cache is only compatible with versions of mongoose that implement the `model.hydrate` method')
    if (!this.instance) {
      this.instance = new CacheMongoose()
      this.instance.cache = new Cache(cacheOptions)
      this.instance.cacheOptions = cacheOptions

      const cache = this.instance.cache

      extendQuery(mongoose, cache)
      extendAggregate(mongoose, cache)
    }

    return this.instance
  }

  public async clear (customKey?: string): Promise<void> {
    if (!customKey) {
      return this.cache.clear()
    }
    return this.cache.del(customKey)
  }

  public async close (): Promise<void> {
    if (this.cacheOptions.engine === 'redis') {
      await this.cache.close()
    }
  }
}

export default CacheMongoose
