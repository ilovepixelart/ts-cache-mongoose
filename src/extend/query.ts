import { getKey } from '../key'

import type { Mongoose } from 'mongoose'
import type Cache from '../cache/Cache'

export default function extendQuery(mongoose: Mongoose, cache: Cache): void {
  // eslint-disable-next-line @typescript-eslint/unbound-method
  const mongooseExec = mongoose.Query.prototype.exec

  // eslint-disable-next-line @typescript-eslint/explicit-function-return-type
  mongoose.Query.prototype.getCacheKey = function () {
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

  // eslint-disable-next-line @typescript-eslint/explicit-function-return-type
  mongoose.Query.prototype.getCacheTTL = function () {
    return this._ttl
  }

  // eslint-disable-next-line @typescript-eslint/explicit-function-return-type
  mongoose.Query.prototype.cache = function (ttl?: string, customKey?: string) {
    this._ttl = ttl ?? null
    this._key = customKey ?? null
    return this
  }

  // eslint-disable-next-line @typescript-eslint/explicit-function-return-type, sonarjs/cognitive-complexity
  mongoose.Query.prototype.exec = async function (...args: []) {
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

      const constructor = mongoose.model<unknown>(model)

      if (Array.isArray(resultCache)) {
        return resultCache.map((item) => {
          return constructor.hydrate(item)
        })
      } else {
        return constructor.hydrate(resultCache)
      }
    }

    const result = await mongooseExec.call(this) as Record<string, unknown>[] | Record<string, unknown>
    await cache.set(key, result, ttl).catch((err: unknown) => {
      console.error(err)
    })

    return result
  }
}
