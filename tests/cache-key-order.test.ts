import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'

import mongoose, { Schema } from 'mongoose'
import CacheMongoose from '../src/index'
import { server } from './mongo/server'

// MongoDB compares an embedded document by equality field by field, in order, so
// { sub: { a: 1, b: 2 } } and { sub: { b: 2, a: 1 } } match different documents.
// Top-level filter fields are order independent.

const OSchema = new Schema({ name: String, n: Number, sub: Schema.Types.Mixed })
const OModel = mongoose.model('KeyOrder', OSchema)
const ORef = mongoose.model('KeyOrderRef', new Schema({ refs: [{ type: Schema.Types.ObjectId, ref: 'KeyOrder' }] }))

describe('cache key field order', () => {
  const instance = server('cache-key-order')
  let cache: CacheMongoose

  beforeAll(async () => {
    cache = CacheMongoose.init(mongoose, { engine: 'memory' })
    await instance.create()
  })

  afterAll(async () => {
    await cache.clear()
    await cache.close()
    await instance.destroy()
  })

  beforeEach(async () => {
    await OModel.deleteMany({})
    await cache.clear()
    await OModel.collection.insertMany([
      { name: 'ab', n: 1, sub: { a: 1, b: 2 } },
      { name: 'ba', n: 2, sub: { b: 2, a: 1 } },
    ])
  })

  describe('aggregate $match', () => {
    it('serves an embedded document equality in the other field order its own rows', async () => {
      await OModel.aggregate([{ $match: { sub: { a: 1, b: 2 } } }]).cache()
      const second = await OModel.aggregate([{ $match: { sub: { b: 2, a: 1 } } }]).cache()

      expect(second.map((d) => d.name)).toEqual(['ba'])
    })

    it('serves embedded document equality inside a $lookup pipeline its own rows', async () => {
      const lookup = (sub: Record<string, number>) => [{ $match: { name: 'ab' } }, { $lookup: { from: OModel.collection.collectionName, pipeline: [{ $match: { sub } }], as: 'hits' } }, { $project: { _id: 0, hits: '$hits.name' } }]
      await OModel.aggregate(lookup({ a: 1, b: 2 })).cache()
      const second = await OModel.aggregate(lookup({ b: 2, a: 1 })).cache()

      expect(second).toEqual([{ hits: ['ba'] }])
    })

    it('serves an object literal comparison in an expression in the other field order its own result', async () => {
      const compare = (sub: Record<string, number>) => [{ $match: { name: 'ab' } }, { $project: { _id: 0, same: { $eq: ['$sub', sub] } } }]
      await OModel.aggregate(compare({ a: 1, b: 2 })).cache()
      const second = await OModel.aggregate(compare({ b: 2, a: 1 })).cache()

      expect(second).toEqual([{ same: false }])
    })

    it('still hits the cache for the same $match on the same model', async () => {
      await OModel.aggregate([{ $match: { sub: { a: 1, b: 2 } } }]).cache()
      await OModel.updateMany({}, { name: 'changed' })
      const hit = await OModel.aggregate([{ $match: { sub: { a: 1, b: 2 } } }]).cache()

      expect(hit.map((d) => d.name)).toEqual(['ab'])
    })
  })

  describe('find', () => {
    it('serves an embedded document equality filter in the other field order its own rows', async () => {
      await OModel.find({ sub: { a: 1, b: 2 } })
        .lean()
        .cache()
      const second = await OModel.find({ sub: { b: 2, a: 1 } })
        .lean()
        .cache()

      expect(second.map((d) => d.name)).toEqual(['ba'])
    })

    it('serves a populate match on an embedded document in the other field order its own rows', async () => {
      const refs = (await OModel.find().lean()).map((d) => d._id)
      await ORef.deleteMany({})
      await ORef.create({ refs })
      const populated = async (sub: Record<string, number>) => {
        const doc = await ORef.findOne().populate({ path: 'refs', match: { sub } }).lean().cache()
        return ((doc?.refs ?? []) as unknown as { name: string }[]).map((d) => d.name)
      }

      await populated({ a: 1, b: 2 })

      expect(await populated({ b: 2, a: 1 })).toEqual(['ba'])
    })

    it('serves a sort in the other key order its own order', async () => {
      await OModel.collection.insertOne({ name: 'c', n: 1, sub: { a: 0 } })
      await OModel.find({}).sort({ n: 1, name: -1 }).lean().cache()
      const second = await OModel.find({}).sort({ name: -1, n: 1 }).lean().cache()

      expect(second.map((d) => d.name)).toEqual(['c', 'ba', 'ab'])
    })
  })
})
