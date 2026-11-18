import assert from 'node:assert/strict'
import mongoose from 'mongoose'
import { Run, reads } from '../harness.ts'
import { models } from '../models.ts'

import type { CacheOptions } from '../../../src/index.ts'
import type { Context, Result } from '../harness.ts'

// The entry points' shape, init() as a process-wide singleton, and the options init() rejects.

const ownNames = (target: object, ignore: string[]): string[] =>
  Object.getOwnPropertyNames(target)
    .filter((name) => !ignore.includes(name))
    .sort()

export const exportsGroup = async (ctx: Context): Promise<Result[]> => {
  const run = new Run()
  await run.scenario('the root entry is the class with init, clear and close', async () => {
    const cache = await ctx.loaders.load()
    const observed = { type: typeof cache, statics: ownNames(cache, ['length', 'name', 'prototype']), methods: ownNames(cache.prototype, ['constructor']) }
    assert.deepEqual(observed, { type: 'function', statics: ['init'], methods: ['clear', 'close'] })
    return observed
  })
  await run.scenario('the nest entry exports CacheModule, CacheService and CACHE_OPTIONS', async () => {
    const nest = await ctx.loaders.loadNest()
    const observed = Object.keys(nest).sort()
    assert.deepEqual(observed, ['CACHE_OPTIONS', 'CacheModule', 'CacheService'])
    return observed
  })
  await run.scenario('init() returns the first instance and ignores later options', async () => {
    const cache = await ctx.loaders.load()
    const first = cache.init(mongoose, { engine: 'memory' })
    const second = cache.init(mongoose, { engine: 'redis', engineOptions: { host: '127.0.0.1', port: 1, lazyConnect: true } })
    assert.equal(second, first)
    const { Book } = models(mongoose.connection)
    await Book.find({ genre: 'fantasy' }).lean().cache()
    await Book.find({ genre: 'fantasy' }).lean().cache()
    assert.equal(reads.count, 1, 'the memory engine of the first init() did not serve the second call')
    return { same: true, roundTrips: reads.count }
  })
  return run.results
}

// After init() throws, the same process can call init() again with valid options; what that
// returns is recorded as observed, not asserted.
const rejectedOptions =
  (options: CacheOptions, message: string) =>
  async (ctx: Context): Promise<Result[]> => {
    const run = new Run()
    const cache = await ctx.loaders.load()
    await run.scenario(`init() rejects ${JSON.stringify(options)}`, async () => {
      assert.throws(() => cache.init(mongoose, options), { name: 'Error', message })
      return message
    })
    await run.scenario('a valid init() after a rejected one', async () => {
      const instance = cache.init(mongoose, { engine: 'memory' })
      const queryHasCache = typeof (mongoose.Query.prototype as { cache?: unknown }).cache
      const clear = await instance.clear().then(
        () => 'resolved',
        (err: Error) => `rejected with ${err.name}`,
      )
      return { queryHasCache, clear }
    })
    return run.results
  }

export const initInvalidEngine = rejectedOptions({ engine: 'nope' as 'memory' }, 'Invalid engine name: nope')

export const initRedisWithoutOptions = rejectedOptions({ engine: 'redis' }, 'Engine options are required for redis engine')
