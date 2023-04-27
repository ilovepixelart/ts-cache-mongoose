import _ from 'lodash'

import type { Mongoose } from 'mongoose'
import type Cache from '../cache/Cache'

import { getKey } from '../crypto'

export default function extendQuery (mongoose: Mongoose, cache: Cache): void {
  // eslint-disable-next-line @typescript-eslint/unbound-method
  const mongooseExec = mongoose.Query.prototype.exec

  // eslint-disable-next-line @typescript-eslint/explicit-function-return-type
  mongoose.Query.prototype.getCacheKey = function () {
    if (this._key) return this._key

    const filter = this.getFilter()
    const update = this.getUpdate()
    const options = this.getOptions()

    const data: Record<string, unknown> = {
      model: this.model.modelName,
      op: this.op,
      filter,
      update,
      skip: options.skip,
      limit: options.limit,
      sort: options.sort,
      _fields: this._fields,
      _path: this._path,
      _distinct: this._distinct
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
    if (!_.has(this, '_ttl')) {
      return mongooseExec.apply(this)
    }

    const key = this.getCacheKey()
    const ttl = this.getCacheTTL()

    const model = this.model.modelName

    const resultCache = await cache.get(key).catch((err) => {
      console.error(err)
    })

    if (resultCache) {
      const constructor = mongoose.model(model)
      if (_.isArray(resultCache)) {
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
