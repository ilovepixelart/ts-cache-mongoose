import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

import mongoose, { Schema, Types } from 'mongoose'
import CacheMongoose from '../src/index'
import { server } from './mongo/server'

// What a user observes from cached queries other than the shape of a non-lean hit:
// lean, count and distinct results, hits that skip MongoDB, init hooks and errors.

const ContractSchema = new Schema({ name: String, n: Number, role: { type: String, default: 'user' } })
let inits = 0
ContractSchema.post('init', () => {
  inits++
})
const Contract = mongoose.model('QueryContract', ContractSchema)

describe('cached query contract', () => {
  const instance = server('cache-query-contract')
  const onError = vi.fn()
  let cache: CacheMongoose

  beforeAll(async () => {
    cache = CacheMongoose.init(mongoose, { engine: 'memory', onError })
    await instance.create()
  })

  afterAll(async () => {
    await cache.clear()
    await cache.close()
    await instance.destroy()
  })

  beforeEach(async () => {
    onError.mockReset()
    await cache.clear()
    await Contract.deleteMany({})
    await Contract.create([
      { name: 'a', n: 1, role: 'admin' },
      { name: 'b', n: 2, role: 'user' },
    ])
  })

  it('returns a lean find hit as plain objects equal to the miss, without querying again', async () => {
    const miss = await Contract.find().sort({ name: 1 }).lean().cache()
    await Contract.create({ name: 'c', n: 3 })
    const hit = await Contract.find().sort({ name: 1 }).lean().cache()
    expect(hit).toEqual(miss)
    expect(hit).toHaveLength(2)
    expect(hit[0]).not.toBeInstanceOf(mongoose.Document)
    expect(hit[0]?._id).toBeInstanceOf(Types.ObjectId)
  })

  it('returns a lean findOne hit as a plain object equal to the miss', async () => {
    const miss = await Contract.findOne({ name: 'a' }).lean().cache()
    await Contract.updateOne({ name: 'a' }, { n: 10 })
    const hit = await Contract.findOne({ name: 'a' }).lean().cache()
    expect(hit).toEqual(miss)
    expect(hit?.n).toBe(1)
  })

  it('returns a cached countDocuments and distinct without querying again', async () => {
    const count = await Contract.countDocuments().cache()
    const names = await Contract.distinct('name').cache()
    await Contract.create({ name: 'c', n: 3 })
    expect(await Contract.countDocuments().cache()).toBe(count)
    expect(await Contract.distinct('name').cache()).toEqual(names)
    expect(count).toBe(2)
    expect(names).toEqual(['a', 'b'])
  })

  it('serves a non-lean find hit without querying again', async () => {
    await Contract.find().sort({ name: 1 }).cache()
    await Contract.create({ name: 'c', n: 3 })
    const hit = await Contract.find().sort({ name: 1 }).cache()
    expect(hit.map((d) => d.name)).toEqual(['a', 'b'])
    expect(hit[0]).toBeInstanceOf(Contract)
  })

  it('caches a find that matched nothing as an empty array', async () => {
    const miss = await Contract.find({ name: 'c' }).cache()
    await Contract.create({ name: 'c', n: 3 })
    const hit = await Contract.find({ name: 'c' }).cache()
    expect(miss).toEqual([])
    expect(hit).toEqual([])
  })

  it('runs init hooks once per document on a non-lean miss and on a non-lean hit', async () => {
    inits = 0
    await Contract.find().sort({ name: 1 }).cache()
    expect(inits).toBe(2)
    await Contract.find().sort({ name: 1 }).cache()
    expect(inits).toBe(4)
  })

  it('does not run init hooks on a lean hit', async () => {
    inits = 0
    await Contract.find().sort({ name: 1 }).lean().cache()
    await Contract.find().sort({ name: 1 }).lean().cache()
    expect(inits).toBe(0)
  })

  it('does not report errors for cached lean and flat non-lean queries', async () => {
    await Contract.find().lean().cache()
    await Contract.find().lean().cache()
    await Contract.findOne({ name: 'a' }).cache()
    await Contract.findOne({ name: 'a' }).cache()
    expect(onError).not.toHaveBeenCalled()
  })

  it('returns the hit of a custom key for any query that uses that key', async () => {
    await Contract.find({ name: 'a' }).lean().cache('1 minute', 'shared-key')
    const other = await Contract.find({ name: 'b' }).lean().cache('1 minute', 'shared-key')
    expect(other.map((d) => d.name)).toEqual(['a'])
  })
})
