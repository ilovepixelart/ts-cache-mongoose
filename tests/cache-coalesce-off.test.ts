import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'

import mongoose, { Schema } from 'mongoose'
import CacheMongoose from '../src/index'
import { server } from './mongo/server'

// With coalesce: false every concurrent caller of a cold key runs its own query, as before.

const CALLERS = 50

const OffItem = mongoose.model('CoalesceOffItem', new Schema({ name: String, n: Number }))

describe('coalesce: false', () => {
  const instance = server('cache-coalesce-off')
  let reads = 0
  let cache: CacheMongoose

  beforeAll(async () => {
    cache = CacheMongoose.init(mongoose, { engine: 'memory', coalesce: false })
    await instance.create()
    mongoose.set('debug', (_collection: string, method: string) => {
      if (method === 'find' || method === 'aggregate') reads++
    })
  })

  afterAll(async () => {
    mongoose.set('debug', false)
    await cache.clear()
    await cache.close()
    await instance.destroy()
  })

  beforeEach(async () => {
    await cache.clear()
    await OffItem.deleteMany({})
    await OffItem.create([
      { name: 'a', n: 1 },
      { name: 'b', n: 2 },
    ])
    reads = 0
  })

  it('runs one MongoDB round trip per concurrent caller of a cold query', async () => {
    const results = await Promise.all(Array.from({ length: CALLERS }, () => OffItem.find({ n: 1 }).lean().cache()))
    expect(reads).toBe(CALLERS)
    for (const rows of results) expect(rows.map((row) => row.name)).toEqual(['a'])
  })

  it('runs one MongoDB round trip per concurrent caller of a cold aggregate', async () => {
    await Promise.all(Array.from({ length: CALLERS }, () => OffItem.aggregate([{ $match: { n: 1 } }]).cache()))
    expect(reads).toBe(CALLERS)
  })

  it('still serves the next query from the cache', async () => {
    await Promise.all(Array.from({ length: CALLERS }, () => OffItem.find({ n: 1 }).lean().cache()))
    reads = 0
    await OffItem.find({ n: 1 }).lean().cache()
    expect(reads).toBe(0)
  })

  // A failing query must reject for its caller only. An unhandled rejection ends a Node process
  // even when the caller caught the error.
  it.each([
    [
      'find',
      () =>
        OffItem.find({ $expr: { $nope: 1 } } as never)
          .lean()
          .cache()
          .exec(),
    ],
    [
      'non-lean findOne',
      () =>
        OffItem.findOne({ $expr: { $nope: 1 } } as never)
          .cache()
          .exec(),
    ],
    [
      'aggregate',
      () =>
        OffItem.aggregate([{ $nope: 1 }] as never)
          .cache()
          .exec(),
    ],
  ])('a failing cached %s rejects for its caller without an unhandled rejection', async (_label, run) => {
    const unhandled: unknown[] = []
    const listener = (reason: unknown) => unhandled.push(reason)
    process.on('unhandledRejection', listener)
    try {
      await expect(run()).rejects.toThrow()
      await new Promise((resolve) => setTimeout(resolve, 50))
    } finally {
      process.off('unhandledRejection', listener)
    }
    expect(unhandled).toEqual([])
  })
})
