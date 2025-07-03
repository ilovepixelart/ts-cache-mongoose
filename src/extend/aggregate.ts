import { getKey } from '../key'

import type { Mongoose } from 'mongoose'
import type { Cache } from '../cache/Cache'
import type { CacheTTL } from '../types'

export function extendAggregate(mongoose: Mongoose, cache: Cache): void {
  const mongooseExec = mongoose.Aggregate.prototype.exec

  mongoose.Aggregate.prototype.getCacheKey = function (): string {
    if (this._key != null) return this._key

    return getKey({
      pipeline: this.pipeline(),
    })
  }

  mongoose.Aggregate.prototype.getCacheTTL = function (): CacheTTL | null {
    return this._ttl
  }

  mongoose.Aggregate.prototype.cache = function (ttl?: CacheTTL, customKey?: string) {
    this._ttl = ttl ?? null
    this._key = customKey ?? null
    return this
  }

  mongoose.Aggregate.prototype.exec = async function (...args: []) {
    // biome-ignore lint/suspicious/noPrototypeBuiltins: to support node 16
    if (!Object.prototype.hasOwnProperty.call(this, '_ttl')) {
      return mongooseExec.apply(this, args)
    }

    const key = this.getCacheKey()
    const ttl = this.getCacheTTL()

    const resultCache = await cache.get(key).catch((err: unknown) => {
      console.error(err)
    })

    if (resultCache) {
      return resultCache
    }

    const result = (await mongooseExec.call(this)) as Record<string, unknown>[] | Record<string, unknown>
    await cache.set(key, result, ttl).catch((err: unknown) => {
      console.error(err)
    })

    return result
  }
}
