import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'

import mongoose, { Schema } from 'mongoose'
import CacheMongoose from '../src/index'
import { server } from './mongo/server'

// What a user observes on a non-lean cache hit: hydrated documents of the queried model,
// equal to the cache miss, saveable, and of the right discriminator class.

const BaseSchema = new Schema({ name: String, role: { type: String, default: 'user' } })
const Base = mongoose.model('HydBase', BaseSchema)
const Child = Base.discriminator('HydChild', new Schema({ extra: String }))

describe('non-lean cache hit contract', () => {
  const instance = server('cache-hydrate-contract')
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
    await Base.deleteMany({})
    await cache.clear()
    await Base.create({ name: 'a' })
    await Child.create({ name: 'b', extra: 'e' })
  })

  it('returns hydrated documents of the model, equal to the miss', async () => {
    const miss = await Base.find().sort({ name: 1 }).cache()
    const hit = await Base.find().sort({ name: 1 }).cache()
    expect(hit).toHaveLength(2)
    for (const doc of hit) {
      expect(doc).toBeInstanceOf(Base)
      expect(doc.isNew).toBe(false)
    }
    expect(hit.map((d) => d.toObject())).toEqual(miss.map((d) => d.toObject()))
  })

  it('returns a hydrated document for findOne', async () => {
    await Base.findOne({ name: 'a' }).cache()
    const hit = await Base.findOne({ name: 'a' }).cache()
    expect(hit).toBeInstanceOf(Base)
    expect(hit?.name).toBe('a')
    expect(hit?.role).toBe('user')
  })

  it('hydrates a discriminator document into its discriminator class', async () => {
    await Base.find().sort({ name: 1 }).cache()
    const hit = await Base.find().sort({ name: 1 }).cache()
    expect(hit[1]).toBeInstanceOf(Child)
    expect(hit[1]?.get('extra')).toBe('e')
  })

  it('saves a modified hit document to the database', async () => {
    await Base.findOne({ name: 'a' }).cache()
    const hit = await Base.findOne({ name: 'a' }).cache()
    if (!hit) throw new Error('expected a hit')
    hit.name = 'renamed'
    await hit.save()
    expect(await Base.countDocuments({ name: 'renamed' })).toBe(1)
  })

  it('returns null for a findOne that matches nothing', async () => {
    await Base.findOne({ name: 'none' }).cache()
    expect(await Base.findOne({ name: 'none' }).cache()).toBeNull()
  })
})
