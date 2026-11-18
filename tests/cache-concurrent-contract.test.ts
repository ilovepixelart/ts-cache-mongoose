import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

import mongoose, { Schema } from 'mongoose'
import CacheMongoose from '../src/index'
import { server } from './mongo/server'

// What every caller of concurrent cached queries observes: its own correct result, its own
// objects, the query's own error, a cache hit afterwards, and sessions bypassing the cache.

const READ_METHODS = new Set(['find', 'findOne', 'aggregate', 'countDocuments', 'distinct'])
const CALLERS = 20

const Owner = mongoose.model('ConcurrentOwner', new Schema({ name: String }))

const ItemSchema = new Schema({ name: String, n: Number, tags: [String], meta: Schema.Types.Mixed, owner: { type: Schema.Types.ObjectId, ref: 'ConcurrentOwner' } })
let failNext = false
ItemSchema.pre('find', () => {
  if (failNext) throw new Error('find refused')
})
const Item = mongoose.model('ConcurrentItem', ItemSchema)

type Row = { name: string; n: number; tags: string[]; meta: { k: string }; owner?: { name: string } }

const plain = (value: unknown): unknown => JSON.parse(JSON.stringify(value))

describe('concurrent cached queries', () => {
  const instance = server('cache-concurrent-contract')
  const onError = vi.fn()
  let reads = 0
  let cache: CacheMongoose

  beforeAll(async () => {
    cache = CacheMongoose.init(mongoose, { engine: 'memory', onError })
    await instance.create()
    mongoose.set('debug', (_collection: string, method: string) => {
      if (READ_METHODS.has(method)) reads++
    })
  })

  afterAll(async () => {
    mongoose.set('debug', false)
    await cache.clear()
    await cache.close()
    await instance.destroy()
  })

  beforeEach(async () => {
    failNext = false
    onError.mockReset()
    await cache.clear()
    await Item.deleteMany({})
    await Owner.deleteMany({})
    const [ann, bob] = await Owner.create([{ name: 'ann' }, { name: 'bob' }])
    await Item.create([
      { name: 'a', n: 1, tags: ['x'], meta: { k: 'a' }, owner: ann?._id },
      { name: 'b', n: 2, tags: ['y'], meta: { k: 'b' }, owner: bob?._id },
    ])
    reads = 0
  })

  const all = <T>(build: () => PromiseLike<T>): Promise<T[]> => Promise.all(Array.from({ length: CALLERS }, build))

  const queries: [string, () => PromiseLike<unknown>, () => PromiseLike<unknown>][] = [
    [
      'lean find',
      () =>
        Item.find({ n: { $gte: 1 } })
          .sort({ n: 1 })
          .lean()
          .cache(),
      () =>
        Item.find({ n: { $gte: 1 } })
          .sort({ n: 1 })
          .lean(),
    ],
    [
      'find',
      () =>
        Item.find({ n: { $gte: 1 } })
          .sort({ n: 1 })
          .cache(),
      () => Item.find({ n: { $gte: 1 } }).sort({ n: 1 }),
    ],
    ['findOne', () => Item.findOne({ name: 'a' }).cache(), () => Item.findOne({ name: 'a' })],
    ['lean findOne', () => Item.findOne({ name: 'a' }).lean().cache(), () => Item.findOne({ name: 'a' }).lean()],
    ['countDocuments', () => Item.countDocuments({ n: { $gte: 1 } }).cache(), () => Item.countDocuments({ n: { $gte: 1 } })],
    ['distinct', () => Item.distinct('name').cache(), () => Item.distinct('name')],
    ['aggregate', () => Item.aggregate([{ $match: { n: { $gte: 1 } } }, { $sort: { n: 1 } }]).cache(), () => Item.aggregate([{ $match: { n: { $gte: 1 } } }, { $sort: { n: 1 } }])],
    ['populated find', () => Item.find({}).sort({ n: 1 }).populate('owner').cache(), () => Item.find({}).sort({ n: 1 }).populate('owner')],
  ]

  it.each(queries)('gives every caller of a concurrent %s the result MongoDB returns', async (_name, cached, uncached) => {
    const expected = plain(await uncached())
    const results = await all(cached)
    for (const result of results) expect(plain(result)).toEqual(expected)
    expect(onError).not.toHaveBeenCalled()
  })

  it.each(queries)('serves a %s from the cache after a concurrent burst', async (_name, cached) => {
    const first = plain((await all(cached))[0])
    await Item.updateMany({}, { name: 'changed', n: 9 })
    const before = reads
    expect(plain(await cached())).toEqual(first)
    expect(reads).toBe(before)
  })

  it('gives every caller of a concurrent non-lean find documents of the model', async () => {
    const results = await all(() => Item.find({}).cache())
    for (const docs of results) {
      for (const doc of docs) expect(doc).toBeInstanceOf(Item)
    }
  })

  it('gives every caller of a concurrent populated find populated documents', async () => {
    const results = await all(() => Item.find({}).sort({ n: 1 }).populate('owner').cache())
    for (const docs of results) {
      expect(docs[0]?.populated('owner')).toBeDefined()
      expect(docs[0]?.owner).toBeInstanceOf(Owner)
    }
  })

  it('keeps the documents of concurrent non-lean callers apart', async () => {
    const results = await all(() => Item.find({}).sort({ n: 1 }).populate('owner').cache())
    const [mine, ...others] = results.map((docs) => docs as unknown as (mongoose.Document & Row)[])
    const doc = mine?.[0] as mongoose.Document & Row
    doc.name = 'mutated'
    doc.tags.push('mutated')
    doc.meta.k = 'mutated'
    ;(doc.owner as { name: string }).name = 'mutated'
    for (const docs of others) {
      expect(docs[0]?.name).toBe('a')
      expect([...(docs[0]?.tags ?? [])]).toEqual(['x'])
      expect(docs[0]?.meta).toEqual({ k: 'a' })
      expect(docs[0]?.owner?.name).toBe('ann')
    }
  })

  it('keeps the lean results of concurrent callers apart', async () => {
    const results = (await all(() => Item.find({}).sort({ n: 1 }).lean().cache())) as unknown as Row[][]
    const [mine, ...others] = results
    mine?.pop()
    const row = mine?.[0] as Row
    row.name = 'mutated'
    row.tags.push('mutated')
    row.meta.k = 'mutated'
    for (const rows of others) expect(plain(rows)).toEqual([expect.objectContaining({ name: 'a', tags: ['x'], meta: { k: 'a' } }), expect.objectContaining({ name: 'b' })])
  })

  it('keeps the distinct lists and aggregate results of concurrent callers apart', async () => {
    const lists = await all(() => Item.distinct('name').cache())
    lists[0]?.push('mutated')
    for (const list of lists.slice(1)) expect(list).toEqual(['a', 'b'])

    const rows = (await all(() => Item.aggregate([{ $sort: { n: 1 } }]).cache())) as unknown as Row[][]
    const row = rows[0]?.[0] as Row
    row.name = 'mutated'
    row.meta.k = 'mutated'
    for (const result of rows.slice(1)) expect(result[0]).toMatchObject({ name: 'a', meta: { k: 'a' } })
  })

  it('gives concurrent queries with different filters their own results', async () => {
    const results = await Promise.all(
      Array.from({ length: CALLERS }, (_, i) =>
        Item.find({ n: (i % 2) + 1 })
          .lean()
          .cache(),
      ),
    )
    for (const [i, rows] of results.entries()) expect(rows.map((row) => row.name)).toEqual([i % 2 === 0 ? 'a' : 'b'])
  })

  it('rejects every caller of a concurrent query that fails with its error, and does not cache the failure', async () => {
    failNext = true
    const outcomes = await Promise.allSettled(Array.from({ length: CALLERS }, () => Item.find({ n: 1 }).lean().cache()))
    for (const outcome of outcomes) {
      expect(outcome.status).toBe('rejected')
      expect((outcome as PromiseRejectedResult).reason).toBeInstanceOf(Error)
      expect((outcome as PromiseRejectedResult).reason.message).toBe('find refused')
    }
    failNext = false
    const rows = await Item.find({ n: 1 }).lean().cache()
    expect(rows.map((row) => row.name)).toEqual(['a'])
    expect(onError).not.toHaveBeenCalled()
  })

  it('runs every concurrent query in a session against MongoDB', async () => {
    const session = await mongoose.startSession()
    try {
      const results = await all(() => Item.find({ n: 1 }).lean().session(session).cache())
      expect(reads).toBe(CALLERS)
      for (const rows of results) expect(rows.map((row) => row.name)).toEqual(['a'])
    } finally {
      await session.endSession()
    }
  })

  it('runs concurrent queries without .cache() against MongoDB', async () => {
    await all(() => Item.find({ n: 1 }).lean())
    expect(reads).toBe(CALLERS)
  })
})
