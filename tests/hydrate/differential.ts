import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'

import mongoose, { Schema } from 'mongoose'
import CacheMongoose from '../../src/index'
import { server } from '../mongo/server'
import { loose } from './loose'
import { canonical } from './observe'

import type { CacheOptions } from '../../src/types'

// Seeded differential test: a fixed sequence of mixed queries (find, findOne, count, distinct,
// aggregate; lean and non-lean; projections, sorts, populate; three models on two databases)
// runs uncached and then twice cached through one shared cache. Every cached result must equal
// the uncached one, the repeat must not reach MongoDB, and onError must stay silent.

const SEEDS = [1, 2, 3, 4]
const QUERIES_PER_SEED = 100
const READ_METHODS = new Set(['find', 'findOne', 'aggregate', 'countDocuments', 'distinct'])

const T = Schema.Types

const lcg = (seed: number) => {
  let state = seed
  const next = (): number => {
    state = (state * 1103515245 + 12345) % 2147483648
    return state / 2147483648
  }
  const pick = <V>(values: readonly V[]): V => values[Math.floor(next() * values.length)] as V
  return { next, pick }
}

const Owner = mongoose.model('DiffOwner', new Schema({ name: String, tier: { type: Number, default: 1 } }))
const schema = new Schema({
  name: String,
  age: Number,
  tags: [String],
  ref: T.ObjectId,
  owner: { type: T.ObjectId, ref: 'DiffOwner' },
  born: Date,
  nested: { a: Number, b: String },
  comments: [{ text: String, n: { type: Number, default: 0 } }],
  meta: T.Mixed,
  price: T.Decimal128,
  role: { type: String, default: 'member' },
})
const models = {
  UserMain: loose(mongoose.model('DiffUser', schema)),
  ItemMain: loose(mongoose.model('DiffItem', schema)),
  UserOther: loose(mongoose.connection.useDb('cache_differential_other').model('DiffUser', schema)),
}

const oid = new mongoose.Types.ObjectId()
const day0 = new Date('2020-01-01T00:00:00Z')

const seedData = async (): Promise<void> => {
  const owners = await Owner.create([{ name: 'o1' }, { name: 'o2', tier: 3 }])
  for (const [key, model] of Object.entries(models)) {
    const docs = []
    for (let i = 0; i < 12; i++) {
      docs.push({
        name: `${key}-${i % 5}`,
        age: (i * 7) % 50,
        tags: i % 2 ? ['a', 'b'] : ['b'],
        ref: i % 3 ? oid : new mongoose.Types.ObjectId(),
        owner: owners[i % 2]?._id,
        born: new Date(day0.getTime() + i * 864e5),
        nested: { a: i % 4, b: `n${i % 3}` },
        comments: i % 3 ? [{ text: `c${i}`, n: i }] : [],
        meta: i % 2 ? oid.toString() : oid,
        price: `${i}.5`,
      })
    }
    await model.create(docs)
    // Written by another client: no defaults, no arrays.
    await model.collection.insertOne({ name: `${key}-raw`, age: 3 })
  }
}

const filters = (pick: <V>(values: readonly V[]) => V) => [
  () => ({}),
  () => ({ age: { $gt: pick([5, 20, 40]) } }),
  () => ({ name: pick(['UserMain-1', 'ItemMain-2', 'UserOther-3', 'UserMain-raw', 'nope']) }),
  () => ({ tags: pick(['a', 'b']) }),
  () => ({ ref: oid }),
  () => ({ meta: pick([oid, oid.toString()]) }),
  () => ({ born: { $gte: new Date(day0.getTime() + pick([0, 3, 8]) * 864e5) } }),
  () => ({ 'nested.a': pick([0, 1, 2]) }),
  () => ({ name: { $regex: pick(['^User', '^Item', '-1$']), $options: pick(['', 'i']) } }),
  () => ({ age: { $in: [0, 3, 7, 14] } }),
  () => ({ $or: [{ age: { $lt: 10 } }, { tags: 'a' }] }),
  () => ({ name: undefined }),
  () => ({ name: null }),
]
const sorts = [null, { age: 1 }, { age: -1 }, { age: 1, name: 1 }, { name: 1, age: 1 }, { 'nested.a': -1, age: 1, name: 1 }]
const projections = [null, 'name age', '-tags', { name: 1 }, { age: 1, _id: 0 }, 'name comments.text', '-nested.b -role', 'name owner']
const populates = [null, null, 'owner', { path: 'owner', select: 'name' }]
const ops = ['find', 'find', 'find', 'findOne', 'countDocuments', 'distinct', 'aggregate'] as const
const aggregateTails = [{ $count: 'n' }, { $project: { name: 1, age: 1 } }, { $group: { _id: '$nested.a', c: { $sum: 1 } } }]
const distinctFields = ['name', 'age', 'nested.a']

type Built = { describe: string; run: (cached: boolean) => Promise<unknown> }

const draw = (seed: number, count: number): Built[] => {
  const { next, pick } = lcg(seed)
  const out: Built[] = []
  for (let i = 0; i < count; i++) {
    // Every choice is drawn on every iteration, so one query's shape never shifts the next.
    const modelKey = pick(Object.keys(models) as (keyof typeof models)[])
    const op = pick(ops)
    const filter = pick(filters(pick))()
    const sort = pick(sorts)
    const projection = pick(projections)
    const populate = pick(populates)
    const lean = next() < 0.5
    const limit = pick([0, 0, 3, 5])
    const skip = pick([0, 0, 2])
    const tail = pick(aggregateTails)
    const distinctField = pick(distinctFields)
    const model = models[modelKey]

    const run = (cached: boolean): Promise<unknown> => {
      if (op === 'aggregate') {
        const match = 'name' in filter && filter.name === undefined ? {} : filter
        const pipeline: Record<string, unknown>[] = [{ $match: match }]
        if (sort) pipeline.push({ $sort: sort })
        pipeline.push(tail)
        if ('$group' in tail) pipeline.push({ $sort: { _id: 1 } })
        const aggregate = model.aggregate(pipeline)
        return (cached ? aggregate.cache() : aggregate).exec()
      }
      if (op === 'distinct') {
        const query = model.distinct(distinctField, filter)
        return (cached ? query.cache() : query).exec()
      }
      if (op === 'countDocuments') {
        const query = model.countDocuments(filter)
        return (cached ? query.cache() : query).exec()
      }
      let query = op === 'find' ? model.find(filter) : model.findOne(filter)
      if (sort) query = query.sort(sort)
      if (projection) query = query.select(projection)
      if (populate) query = query.populate(populate)
      if (op === 'find' && limit) query = query.limit(limit)
      if (op === 'find' && skip) query = query.skip(skip)
      if (lean) query = query.lean()
      return (cached ? query.cache() : query).exec()
    }
    out.push({ describe: `${modelKey}.${op} filter=${JSON.stringify(filter)} sort=${JSON.stringify(sort)} select=${JSON.stringify(projection)} populate=${JSON.stringify(populate)} lean=${lean} limit=${limit} skip=${skip}`, run })
  }
  return out
}

export const describeDifferential = (engine: string, options: () => CacheOptions | undefined): void => {
  describe.skipIf(options() === undefined)(`cached results equal MongoDB's uncached results (${engine})`, () => {
    const instance = server(`cache-differential-${engine}`)
    const onError = vi.fn()
    let reads = 0
    let cache: CacheMongoose

    beforeAll(async () => {
      cache = CacheMongoose.init(mongoose, { ...(options() as CacheOptions), onError })
      await instance.create()
      await cache.clear()
      await seedData()
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

    it.each(SEEDS)('seed %i', async (seed) => {
      const mismatches: string[] = []
      for (const query of draw(seed, QUERIES_PER_SEED)) {
        const uncached = await query.run(false)
        const truth = canonical(uncached)
        const miss = canonical(await query.run(true))
        reads = 0
        const hit = canonical(await query.run(true))
        if (miss !== truth) mismatches.push(`miss: ${query.describe}`)
        if (hit !== truth) mismatches.push(`hit: ${query.describe}`)
        // null and 0 results are not cached yet (an `if (resultCache)` check), so they repeat.
        if (reads !== 0 && uncached !== null && uncached !== 0) mismatches.push(`repeat reached MongoDB ${reads}x: ${query.describe}`)
      }
      expect(mismatches).toEqual([])
      expect(onError).not.toHaveBeenCalled()
    })
  })
}
