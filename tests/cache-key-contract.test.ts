import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'

import mongoose, { Schema } from 'mongoose'
import CacheMongoose from '../src/index'
import { server } from './mongo/server'

// What a user can observe about generated cache keys: their shape, which queries share one,
// and that custom keys are used verbatim.

const CSchema = new Schema({ a: Number, b: Number, name: String, tags: [String], sub: Schema.Types.Mixed })
const CModel = mongoose.model('CDoc', CSchema)
const COther = mongoose.model('COther', CSchema)

const SHA1_HEX = /^[0-9a-f]{40}$/

describe('cache key contract', () => {
  const instance = server('cache-key-contract')
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
    await CModel.deleteMany({})
    await cache.clear()
  })

  describe('query keys', () => {
    it('is a 40 character lowercase hex string', () => {
      expect(CModel.find({ a: 1 }).cache().getCacheKey()).toMatch(SHA1_HEX)
    })

    it('is the same for two identical queries built separately', () => {
      const one = CModel.find({ a: 1, tags: { $in: ['x', 'y'] } })
        .sort({ a: 1 })
        .limit(5)
        .lean()
        .cache()
      const two = CModel.find({ a: 1, tags: { $in: ['x', 'y'] } })
        .sort({ a: 1 })
        .limit(5)
        .lean()
        .cache()
      expect(one.getCacheKey()).toBe(two.getCacheKey())
    })

    it('differs for an embedded document with another field order, which MongoDB matches differently', () => {
      const one = CModel.find({ sub: { x: 1, y: 2 } }).cache()
      const two = CModel.find({ sub: { y: 2, x: 1 } }).cache()
      expect(one.getCacheKey()).not.toBe(two.getCacheKey())
    })

    it('differs for a different filter value', () => {
      expect(CModel.find({ a: 1 }).cache().getCacheKey()).not.toBe(CModel.find({ a: 2 }).cache().getCacheKey())
    })

    it('differs between lean and hydrated queries', () => {
      expect(CModel.find({ a: 1 }).cache().getCacheKey()).not.toBe(CModel.find({ a: 1 }).lean().cache().getCacheKey())
    })

    it('differs between operations', () => {
      const keys = [CModel.find({ a: 1 }).cache().getCacheKey(), CModel.findOne({ a: 1 }).cache().getCacheKey(), CModel.countDocuments({ a: 1 }).cache().getCacheKey(), CModel.distinct('name', { a: 1 }).cache().getCacheKey()]
      expect(new Set(keys).size).toBe(4)
    })

    it('differs between models', () => {
      expect(CModel.find({ a: 1 }).cache().getCacheKey()).not.toBe(COther.find({ a: 1 }).cache().getCacheKey())
    })

    it('differs for skip, limit and projection', () => {
      const keys = [CModel.find({}), CModel.find({}).skip(1), CModel.find({}).limit(1), CModel.find({}).select('name')].map((q) => q.cache().getCacheKey())
      expect(new Set(keys).size).toBe(4)
    })

    it('returns a custom key verbatim', () => {
      expect(CModel.find({ a: 1 }).cache('1 minute', 'custom-key').getCacheKey()).toBe('custom-key')
    })
  })

  describe('aggregate keys', () => {
    it('is a 40 character lowercase hex string', () => {
      expect(
        CModel.aggregate([{ $match: { a: 1 } }])
          .cache()
          .getCacheKey(),
      ).toMatch(SHA1_HEX)
    })

    it('is the same for two identical pipelines built separately', () => {
      const one = CModel.aggregate([{ $match: { a: 1 } }, { $group: { _id: '$name', n: { $sum: 1 } } }]).cache()
      const two = CModel.aggregate([{ $match: { a: 1 } }, { $group: { _id: '$name', n: { $sum: 1 } } }]).cache()
      expect(one.getCacheKey()).toBe(two.getCacheKey())
    })

    it('ignores the key order inside $match', () => {
      const one = CModel.aggregate([{ $match: { a: 1, b: 2 } }]).cache()
      const two = CModel.aggregate([{ $match: { b: 2, a: 1 } }]).cache()
      expect(one.getCacheKey()).toBe(two.getCacheKey())
    })

    it('differs for a different pipeline', () => {
      expect(
        CModel.aggregate([{ $match: { a: 1 } }])
          .cache()
          .getCacheKey(),
      ).not.toBe(
        CModel.aggregate([{ $match: { a: 2 } }])
          .cache()
          .getCacheKey(),
      )
    })

    it('returns a custom key verbatim', () => {
      expect(
        CModel.aggregate([{ $match: { a: 1 } }])
          .cache('1 minute', 'custom-agg')
          .getCacheKey(),
      ).toBe('custom-agg')
    })
  })

  describe('cache behaviour by key', () => {
    it('serves a second identical query from the cache', async () => {
      await CModel.create({ a: 1, name: 'before' })
      await CModel.find({ a: 1 }).lean().cache()
      await CModel.updateMany({ a: 1 }, { name: 'after' })
      const hit = await CModel.find({ a: 1 }).lean().cache()
      expect(hit.map((d) => d.name)).toEqual(['before'])
    })

    it('serves an embedded document match in another field order its own rows', async () => {
      await CModel.create({ a: 1, sub: { x: 1, y: 2 } })
      const first = await CModel.find({ sub: { x: 1, y: 2 } })
        .lean()
        .cache()
      const second = await CModel.find({ sub: { y: 2, x: 1 } })
        .lean()
        .cache()
      expect(first).toHaveLength(1)
      expect(second).toHaveLength(0)
    })

    it('clears a custom key query with clear(customKey)', async () => {
      await CModel.create({ a: 1, name: 'before' })
      await CModel.find({ a: 1 }).lean().cache('1 minute', 'contract-key')
      await CModel.updateMany({ a: 1 }, { name: 'after' })
      await cache.clear('contract-key')
      const fresh = await CModel.find({ a: 1 }).lean().cache('1 minute', 'contract-key')
      expect(fresh.map((d) => d.name)).toEqual(['after'])
    })

    it('shares one entry between a query and an aggregate given the same custom key', async () => {
      await CModel.create({ a: 1, name: 'from-query' })
      const first = await CModel.find({ a: 1 }).lean().cache('1 minute', 'shared-key')
      const second = await CModel.aggregate([{ $match: { a: 999 } }]).cache('1 minute', 'shared-key')
      expect(second).toEqual(first)
    })
  })
})
