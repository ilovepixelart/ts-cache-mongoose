import type { Mongoose } from 'mongoose'
import type Cache from '../cache/Cache'

import { getKey } from '../key'

export default function extendQuery (mongoose: Mongoose, cache: Cache): void {
  // eslint-disable-next-line @typescript-eslint/unbound-method
  const mongooseExec = mongoose.Query.prototype.exec

  // eslint-disable-next-line @typescript-eslint/explicit-function-return-type
  mongoose.Query.prototype.getCacheKey = function () {
    if (this._key) return this._key

    const filter = this.getFilter()
    const update = this.getUpdate()
    const options = this.getOptions()
    const mongooseOptions = this.mongooseOptions()

    const data: Record<string, unknown> = {
      model: this.model.modelName,
      op: this.op,
      filter,
      update,
      options,
      mongooseOptions,
      _path: this._path,
      _fields: this._fields,
      _distinct: this._distinct,
      _conditions: this._conditions
    }

    return getKey(data)
  }

  // eslint-disable-next-line @typescript-eslint/explicit-function-return-type
  mongoose.Query.prototype.getCacheTTL = function () {
    return this._ttl
  }

  // eslint-disable-next-line @typescript-eslint/explicit-function-return-type
  mongoose.Query.prototype.cache = function (ttl?: string, customKey?: string) {
    this._ttl = ttl
    this._key = customKey
    return this
  }

  // eslint-disable-next-line @typescript-eslint/explicit-function-return-type
  mongoose.Query.prototype.exec = async function () {
    if (!Object.prototype.hasOwnProperty.call(this, '_ttl')) {
      return mongooseExec.apply(this)
    }

    const key = this.getCacheKey()
    const ttl = this.getCacheTTL()
    const mongooseOptions = this.mongooseOptions()

    const isCount = this.op?.includes('count')
    const isDistinct = this.op === 'distinct'
    const model = this.model.modelName

    const resultCache = await cache.get(key).catch((err) => {
      console.error(err)
    })

    if (resultCache) {
      if (isCount || isDistinct || mongooseOptions.lean) {
        return resultCache
      }

      const constructor = mongoose.model(model)
      if (Array.isArray(resultCache)) {
        return resultCache.map((item) => constructor.hydrate(item) as Record<string, unknown>)
      } else {
        return constructor.hydrate(resultCache) as Record<string, unknown>
      }
    }

    const result = await mongooseExec.call(this) as Record<string, unknown>[] | Record<string, unknown>
    cache.set(key, result, ttl).catch((err) => {
      console.error(err)
    })

    return result
  }
}
