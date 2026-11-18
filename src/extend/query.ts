import { copyOf } from '../cache/engine/MemoryCacheEngine'
import { getKey, getModelScope, omitKeys } from '../key'
import { runsInSession } from '../session'
import { fromCacheData, toCacheData } from './hydrate'

import type { Mongoose, Query } from 'mongoose'
import type { Cache } from '../cache/Cache'
import type { CacheData, Duration } from '../types'

const isDocuments = (query: Query<unknown, unknown>): boolean => !query.mongooseOptions().lean && (query.op === 'find' || query.op === 'findOne')

export function extendQuery(mongoose: Mongoose, cache: Cache): void {
  const mongooseExec = mongoose.Query.prototype.exec

  // A result that cannot be converted to or from its cached form is reported and served from
  // MongoDB instead, like an engine failure.
  const guard = <T>(convert: () => T): T | undefined => {
    try {
      return convert()
    } catch (err) {
      cache.onError(err as Error)
      return undefined
    }
  }

  mongoose.Query.prototype.getCacheKey = function (): string {
    if (this._key != null) return this._key

    const filter = this.getFilter()
    const update = this.getUpdate()
    const options = omitKeys(this.getOptions(), ['session'])
    const mongooseOptions = this.mongooseOptions()

    return getKey({
      ...getModelScope(this.model),
      op: this.op,
      filter,
      update,
      options,
      mongooseOptions,
      _path: this._path,
      _fields: this._fields,
      _distinct: this._distinct,
      _conditions: this._conditions,
    })
  }

  mongoose.Query.prototype.getDuration = function (): Duration | null {
    return this._ttl
  }

  mongoose.Query.prototype.cache = function (ttl?: Duration, customKey?: string) {
    this._ttl = ttl ?? null
    this._key = customKey ?? null
    return this
  }

  // The result a cached value stands for, or undefined when it cannot be rebuilt here (the query
  // then runs against MongoDB).
  const fromCache = (query: Query<unknown, unknown>, cached: CacheData): unknown => {
    const mongooseOptions = query.mongooseOptions()
    // count, countDocuments and estimatedDocumentCount
    const isCount = query.op?.toLowerCase().includes('count') ?? false
    if (cached != null && isDocuments(query)) return guard(() => fromCacheData(query, cached))
    // Every cached value is a hit, null and 0 included; only undefined means not cached.
    if (cached === null || isCount || query.op === 'distinct' || mongooseOptions.lean) return cached

    // The query's own model: registered on its connection (createConnection(), useDb()), not
    // necessarily on the default one.
    const model = query.model
    if (Array.isArray(cached)) return cached.map((item) => model.hydrate(item))
    return model.hydrate(cached)
  }

  // Runs the query against MongoDB and caches its result: the result, and the value cached.
  const load = async (query: Query<unknown, unknown>, key: string): Promise<{ result: unknown; value: CacheData }> => {
    const result = (await mongooseExec.call(query)) as Record<string, unknown>[] | Record<string, unknown>
    const documents = isDocuments(query)
    const value = documents ? guard(() => toCacheData(query, result)) : result
    if (value === undefined && documents) return { result, value }
    await cache.set(key, value, query.getDuration()).catch((err: unknown) => {
      cache.onError(err as Error)
    })
    return { result, value }
  }

  mongoose.Query.prototype.exec = async function (...args: []) {
    // Reads in a session, explicit or from a surrounding transaction (which may still abort),
    // neither come from nor go to the shared cache.
    if (!Object.hasOwn(this, '_ttl') || runsInSession(this.getOptions(), this.model)) {
      return mongooseExec.apply(this, args)
    }

    const key = this.getCacheKey()

    const resultCache = await cache.get(key).catch((err: unknown) => {
      cache.onError(err as Error)
    })

    if (resultCache !== undefined) {
      const hit = fromCache(this, resultCache)
      if (hit !== undefined) return hit
    }

    // A caller of a key that is already loading gets its own copy of that load's value, as from
    // a cache hit. The copy is taken when the load settles, before the caller that started it
    // can act on its result.
    const pending = cache.pending(key)
    if (pending !== undefined) {
      const shared = await pending
      const joined = shared === undefined ? undefined : fromCache(this, copyOf(shared) as CacheData)
      if (joined !== undefined) return joined
      return (await load(this, key)).result
    }

    const own = load(this, key)
    cache.share(
      key,
      own.then(({ value }) => value),
    )
    return (await own).result
  }
}
