import { getKey } from '../key'

import type { Mongoose } from 'mongoose'
import type { Cache } from '../cache/Cache'
import type { CacheTTL } from '../types'

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

  mongoose.Query.prototype.getCacheTTL = function (): CacheTTL | null {
    return this._ttl
  }

  mongoose.Query.prototype.cache = function (ttl?: CacheTTL, customKey?: string) {
    this._ttl = ttl ?? null
    this._key = customKey ?? null
    return this
  }

  mongoose.Query.prototype.exec = async function (...args: []) {
    // biome-ignore lint/suspicious/noPrototypeBuiltins: to support node 16
    if (!Object.prototype.hasOwnProperty.call(this, '_ttl')) {
      return mongooseExec.apply(this, args)
    }

    const key = this.getCacheKey()
    const ttl = this.getCacheTTL()
    const mongooseOptions = this.mongooseOptions()

    const isCount = this.op?.includes('count') ?? false
    const isDistinct = this.op === 'distinct'
    const model = this.model.modelName

    const resultCache = await cache.get(key).catch((err: unknown) => {
      console.error(err)
    })

    if (resultCache) {
      if (isCount || isDistinct || mongooseOptions.lean) {
        return resultCache
      }

      const modelConstructor = mongoose.model<unknown>(model)

      if (Array.isArray(resultCache)) {
        return resultCache.map((item) => {
          return modelConstructor.hydrate(item)
        })
      }
      return modelConstructor.hydrate(resultCache)
    }

    const result = (await mongooseExec.call(this)) as Record<string, unknown>[] | Record<string, unknown>
    await cache.set(key, result, ttl).catch((err: unknown) => {
      console.error(err)
    })

    return result
  }
}
