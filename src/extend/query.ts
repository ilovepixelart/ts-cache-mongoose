import { getKey, getModelScope, omitKeys } from '../key'
import { runsInSession } from '../session'
import { fromCacheData, toCacheData } from './hydrate'

import type { Mongoose } from 'mongoose'
import type { Cache } from '../cache/Cache'
import type { Duration } from '../types'

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

  mongoose.Query.prototype.exec = async function (...args: []) {
    // Reads in a session, explicit or from a surrounding transaction (which may still abort),
    // neither come from nor go to the shared cache.
    if (!Object.hasOwn(this, '_ttl') || runsInSession(this.getOptions(), this.model)) {
      return mongooseExec.apply(this, args)
    }

    const key = this.getCacheKey()
    const ttl = this.getDuration()
    const mongooseOptions = this.mongooseOptions()

    // count, countDocuments and estimatedDocumentCount
    const isCount = this.op?.toLowerCase().includes('count') ?? false
    const isDistinct = this.op === 'distinct'
    const isDocuments = !mongooseOptions.lean && (this.op === 'find' || this.op === 'findOne')

    const resultCache = await cache.get(key).catch((err: unknown) => {
      cache.onError(err as Error)
    })

    // Every cached value is a hit, null and 0 included; only undefined means not cached.
    if (resultCache != null && isDocuments) {
      const docs = guard(() => fromCacheData(this, resultCache))
      if (docs !== undefined) return docs
    } else if (resultCache !== undefined) {
      if (resultCache === null || isCount || isDistinct || mongooseOptions.lean) {
        return resultCache
      }

      // The query's own model: registered on its connection (createConnection(), useDb()), not
      // necessarily on the default one.
      const model = this.model

      if (Array.isArray(resultCache)) {
        return resultCache.map((item) => {
          return model.hydrate(item)
        })
      }
      return model.hydrate(resultCache)
    }

    const result = (await mongooseExec.call(this)) as Record<string, unknown>[] | Record<string, unknown>
    const value = isDocuments ? guard(() => toCacheData(this, result)) : result
    if (value === undefined && isDocuments) return result
    await cache.set(key, value, ttl).catch((err: unknown) => {
      cache.onError(err as Error)
    })

    return result
  }
}
