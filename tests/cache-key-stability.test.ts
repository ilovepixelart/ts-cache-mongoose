import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import mongoose, { Schema } from 'mongoose'
import CacheMongoose from '../src/index'
import { getKey } from '../src/key'
import { server } from './mongo/server'

// Keys are persisted (the redis engine stores entries under them), so these values pin the
// key format: a change here sends every matching cached entry to a cold miss after upgrade.
describe('cache key stability', () => {
  it('keeps the key of a query', () => {
    const scope = { model: 'Doc', collection: 'docs', db: 'app', host: 'h', port: 1 }
    const query = { op: 'find', filter: { sub: { b: 1, a: 1 }, n: 2 }, options: { sort: { b: 1, a: 1 }, limit: 1 }, mongooseOptions: { lean: true } }
    expect(getKey({ ...scope, ...query })).toBe('e40fcc178062f26fc4d3399796d94c50a35d8d35')
  })

  it('keeps the key of a pipeline whose stages besides $match list their fields alphabetically', () => {
    const scope = { model: 'Doc', collection: 'docs', db: 'app', host: 'h', port: 1 }
    const pipeline = [{ $match: { b: { $gte: 2 }, a: 1 } }, { $sort: { b: 1, a: 1 } }, { $group: { _id: '$a', n: { $sum: 1 } } }]
    expect(getKey({ ...scope, pipeline, options: {} })).toBe('5cfbbc7df858a71e76eae2a4f10a9ae4dcbec8be')
  })
})

describe('aggregate key equality', () => {
  const instance = server('cache-key-stability')
  const SModel = mongoose.model('KeyStability', new Schema({ a: Number, b: Number }))
  let cache: CacheMongoose

  beforeAll(async () => {
    cache = CacheMongoose.init(mongoose, { engine: 'memory' })
    await instance.create()
  })

  afterAll(async () => {
    await cache.close()
    await instance.destroy()
  })

  const key = (pipeline: mongoose.PipelineStage[]) => SModel.aggregate(pipeline).cache().getCacheKey()

  it('ignores the order of top-level $match fields next to operators', () => {
    expect(key([{ $match: { a: 1, $or: [{ b: 1 }, { b: 2 }] } }])).toBe(key([{ $match: { $or: [{ b: 1 }, { b: 2 }], a: 1 } }]))
  })

  it('keeps the order of a $sort stage', () => {
    expect(key([{ $sort: { a: 1, b: 1 } }])).not.toBe(key([{ $sort: { b: 1, a: 1 } }]))
  })

  it('ignores the order of the collation fields', () => {
    const one = SModel.aggregate([{ $match: { a: 1 } }])
      .collation({ locale: 'en', strength: 2 })
      .cache()
    const two = SModel.aggregate([{ $match: { a: 1 } }])
      .collation({ strength: 2, locale: 'en' })
      .cache()
    expect(one.getCacheKey()).toBe(two.getCacheKey())
  })

  it('differs between a pipeline and the same pipeline with an extra stage', () => {
    expect(key([{ $match: { a: 1 } }])).not.toBe(key([{ $match: { a: 1 } }, { $limit: 1 }]))
  })
})
