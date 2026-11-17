import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'

import mongoose, { Schema } from 'mongoose'
import CacheMongoose from '../src/index'
import { server } from './mongo/server'

const PSchema = new Schema({ a: Number, name: String, role: { type: String, default: 'user' } })
const PModel = mongoose.model('HydProj', PSchema)

describe('non-lean cache hits hydrate with the query model', () => {
  const instance = server('cache-hydrate')
  let cache: CacheMongoose
  const uri = () => `mongodb://${mongoose.connection.host}:${mongoose.connection.port}/${mongoose.connection.name}`

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
    await cache.clear()
    await PModel.deleteMany({})
    await PModel.collection.insertOne({ a: 1, name: 'x' })
  })

  describe('models registered on another connection', () => {
    it('returns a hydrated findOne hit for a createConnection() model', async () => {
      const conn = await mongoose.createConnection(uri()).asPromise()
      try {
        const M = conn.model('HydConnOnly', new Schema({ name: String }))
        await M.deleteMany({})
        await M.create({ name: 'c' })
        const miss = await M.findOne({ name: 'c' }).cache()
        const hit = await M.findOne({ name: 'c' }).cache()
        expect(miss?.name).toBe('c')
        expect(hit).toBeInstanceOf(M)
        expect(hit?.name).toBe('c')
      } finally {
        await conn.close()
      }
    })

    it('returns hydrated find hits for a createConnection() model', async () => {
      const conn = await mongoose.createConnection(uri()).asPromise()
      try {
        const M = conn.model('HydConnOnlyMany', new Schema({ name: String }))
        await M.deleteMany({})
        await M.create([{ name: 'c1' }, { name: 'c2' }])
        await M.find().sort({ name: 1 }).cache()
        const hit = await M.find().sort({ name: 1 }).cache()
        expect(hit.map((d) => d.name)).toEqual(['c1', 'c2'])
        expect(hit[0]).toBeInstanceOf(M)
      } finally {
        await conn.close()
      }
    })

    it('binds a hit document of a useDb() model to that database, so save() writes there', async () => {
      const tenant = mongoose.connection.useDb('cache_hydrate_tenant').model('HydProj', PSchema)
      await tenant.deleteMany({})
      await tenant.create({ a: 1, name: 'tenant' })
      await tenant.findOne({ a: 1 }).cache()
      const hit = await tenant.findOne({ a: 1 }).cache()
      if (!hit) throw new Error('expected a hit')
      hit.name = 'renamed'
      await hit.save()
      expect(await tenant.countDocuments({ name: 'renamed' })).toBe(1)
      expect(await PModel.countDocuments({ name: 'renamed' })).toBe(0)
    })

    it('returns a lean hit for a createConnection() model', async () => {
      const conn = await mongoose.createConnection(uri()).asPromise()
      try {
        const M = conn.model('HydConnOnlyLean', new Schema({ name: String }))
        await M.deleteMany({})
        await M.create({ name: 'c' })
        await M.findOne({ name: 'c' }).lean().cache()
        const hit = await M.findOne({ name: 'c' }).lean().cache()
        expect(hit?.name).toBe('c')
      } finally {
        await conn.close()
      }
    })
  })
})
