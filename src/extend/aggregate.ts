import { getKey, getModelScope, omitKeys } from '../key'

import type { Mongoose } from 'mongoose'
import type { Cache } from '../cache/Cache'
import type { Duration } from '../types'

// Options that never change which documents come back. A ClientSession is not data at all.
const NON_DATA_OPTIONS = ['session', 'comment', 'maxTimeMS', 'allowDiskUse', 'batchSize', 'cursor']

export function extendAggregate(mongoose: Mongoose, cache: Cache): void {
  const mongooseExec = mongoose.Aggregate.prototype.exec

  mongoose.Aggregate.prototype.getCacheKey = function (): string {
    if (this._key != null) return this._key

    return getKey({
      ...getModelScope(this.model()),
      pipeline: this.pipeline(),
      options: omitKeys(this.options, NON_DATA_OPTIONS),
    })
  }

  mongoose.Aggregate.prototype.getDuration = function (): Duration | null {
    return this._ttl
  }

  mongoose.Aggregate.prototype.cache = function (ttl?: Duration, customKey?: string) {
    this._ttl = ttl ?? null
    this._key = customKey ?? null
    return this
  }

  mongoose.Aggregate.prototype.exec = async function (...args: []) {
    // Reads in a session (a transaction may later abort) neither come from nor go to the shared cache.
    if (!Object.hasOwn(this, '_ttl') || this.options.session != null) {
      return mongooseExec.apply(this, args)
    }

    const key = this.getCacheKey()
    const ttl = this.getDuration()

    const resultCache = await cache.get(key).catch((err: unknown) => {
      cache.onError(err as Error)
    })

    if (resultCache) {
      return resultCache
    }

    const result = (await mongooseExec.call(this)) as Record<string, unknown>[] | Record<string, unknown>
    await cache.set(key, result, ttl).catch((err: unknown) => {
      cache.onError(err as Error)
    })

    return result
  }
}
