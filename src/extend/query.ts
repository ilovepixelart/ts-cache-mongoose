import { getKey } from '../key'

import type { Mongoose } from 'mongoose'
import type { Cache } from '../cache/Cache'
import type { Duration } from '../types'

export function extendQuery(mongoose: Mongoose, cache: Cache): void {
  const mongooseExec = mongoose.Query.prototype.exec

  mongoose.Query.prototype.getCacheKey = function (): string {
    if (this._key != null) return this._key

    const filter = this.getFilter()
    const update = this.getUpdate()
    const options = this.getOptions()
    const mongooseOptions = this.mongooseOptions()

    return getKey({
      model: this.model.modelName,
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
    if (!Object.hasOwn(this, '_ttl')) {
      return mongooseExec.apply(this, args)
    }

    const key = this.getCacheKey()
    const ttl = this.getDuration()
    const mongooseOptions = this.mongooseOptions()

    const isCount = this.op?.includes('count') ?? false
    const isDistinct = this.op === 'distinct'

    const resultCache = await cache.get(key).catch((err: unknown) => {
      cache.onError(err as Error)
    })

    if (resultCache) {
      if (isCount || isDistinct || mongooseOptions.lean) {
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
    await cache.set(key, result, ttl).catch((err: unknown) => {
      cache.onError(err as Error)
    })

    return result
  }
}
