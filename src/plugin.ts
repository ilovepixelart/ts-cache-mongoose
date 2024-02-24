import Cache from './cache/Cache'

import type { Mongoose } from 'mongoose'
import type ICacheOptions from './interfaces/ICacheOptions'

import extendQuery from './extend/query'
import extendAggregate from './extend/aggregate'

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
  #cache!: Cache

  private constructor () {
    // Private constructor to prevent external instantiation
  }

  public static init (mongoose: Mongoose, cacheOptions: ICacheOptions): CacheMongoose {
    if (!this.#instance) {
      this.#instance = new CacheMongoose()
      this.#instance.#cache = new Cache(cacheOptions)

      const cache = this.#instance.#cache

      extendQuery(mongoose, cache)
      extendAggregate(mongoose, cache)
    }

    return this.#instance
  }

  public async clear (customKey?: string): Promise<void> {
    if (customKey != null) {
      await this.#cache.del(customKey)
    } else {
      await this.#cache.clear()
    }
  }

  public async close (): Promise<void> {
    await this.#cache.close()
  }
}

export default CacheMongoose
