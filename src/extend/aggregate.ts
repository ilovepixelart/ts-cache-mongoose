import type { Mongoose } from 'mongoose'
import type Cache from '../cache/Cache'

import { getKey } from '../key'

export default function extendQuery (mongoose: Mongoose, cache: Cache): void {
  // eslint-disable-next-line @typescript-eslint/unbound-method
  const mongooseExec = mongoose.Aggregate.prototype.exec

  // eslint-disable-next-line @typescript-eslint/explicit-function-return-type
  mongoose.Aggregate.prototype.getCacheKey = function () {
    return this._key || getKey({
      pipeline: this.pipeline()
    })
  }

  // eslint-disable-next-line @typescript-eslint/explicit-function-return-type
  mongoose.Aggregate.prototype.getCacheTTL = function () {
    return this._ttl
  }

  // eslint-disable-next-line @typescript-eslint/explicit-function-return-type
  mongoose.Aggregate.prototype.cache = function (ttl?: string, customKey?: string) {
    this._ttl = ttl ?? null
    this._key = customKey ?? null
    return this
  }

  // eslint-disable-next-line @typescript-eslint/explicit-function-return-type
  mongoose.Aggregate.prototype.exec = async function (...args: []) {
    if (!Object.prototype.hasOwnProperty.call(this, '_ttl')) {
      return mongooseExec.apply(this, args)
    }

    const key = this.getCacheKey()
    const ttl = this.getCacheTTL()

    const resultCache = await cache.get(key).catch((err) => {
      console.error(err)
    })

    if (resultCache) {
      return resultCache
    }

    const result = await mongooseExec.call(this) as Record<string, unknown>[] | Record<string, unknown>
    await cache.set(key, result, ttl).catch((err) => {
      console.error(err)
    })

    return result
  }
}
