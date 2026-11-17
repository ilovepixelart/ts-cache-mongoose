import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'

import { MongoMemoryServer } from 'mongodb-memory-server'
import mongoose, { Schema } from 'mongoose'
import CacheMongoose from '../src/index'
import { server } from './mongo/server'

// Every case caches one query, then runs a second query that MongoDB answers differently.
// The second result must be the database's answer, never the first query's cached rows.

const OID = '64b7f0000000000000000001'
const ISO = '2024-01-01T00:00:00.000Z'
const KSchema = new Schema({ a: Number, b: Number, name: String, m: Schema.Types.Mixed })
const KModel = mongoose.model('KDoc', KSchema)
const KOther = mongoose.model('KOther', new Schema({ name: String }))
// BigInt became a schema type in mongoose 7.
const bigIntModel = () => mongoose.models.KBig ?? mongoose.model('KBig', new Schema({ big: BigInt }))
const sameDatabaseUri = () => `mongodb://${mongoose.connection.host}:${mongoose.connection.port}/${mongoose.connection.name}`
const supportsBigInt = Number(mongoose.version.split('.')[0]) >= 7

describe('cache key collisions', () => {
  const instance = server('cache-key-collisions')
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
    await KModel.deleteMany({})
    await KOther.deleteMany({})
    await cache.clear()
    await KModel.create([
      { a: 1, b: 2, name: 'x', m: new mongoose.Types.ObjectId(OID) },
      { a: 2, b: 1, name: 'y', m: OID },
      { a: 3, b: 3, name: 'z', m: new Date(ISO) },
      { a: 4, b: 4, name: 'w', m: ISO },
    ])
  })

  describe('database identity', () => {
    it('serves each database its own rows for the same model and query', async () => {
      const t1 = mongoose.connection.useDb('cache_key_tenant1').model('KDoc', KSchema)
      const t2 = mongoose.connection.useDb('cache_key_tenant2').model('KDoc', KSchema)
      await t1.deleteMany({})
      await t2.deleteMany({})
      await t1.create({ a: 1, name: 'tenant1-private' })
      await t2.create({ a: 1, name: 'tenant2' })

      await t1.find({ a: 1 }).lean().cache()
      const fromT2 = await t2.find({ a: 1 }).lean().cache()

      expect(fromT2.map((d) => d.name)).toEqual(['tenant2'])
    })

    it('still hits the cache for the same query on the same database', async () => {
      const t1 = mongoose.connection.useDb('cache_key_tenant1').model('KDoc', KSchema)
      await t1.deleteMany({})
      await t1.create({ a: 1, name: 'before' })

      await t1.find({ a: 1 }).lean().cache()
      await t1.updateMany({ a: 1 }, { name: 'after' })
      const hit = await t1.find({ a: 1 }).lean().cache()

      expect(hit.map((d) => d.name)).toEqual(['before'])
    })
    it('serves each deployment its own rows for the same database name', async () => {
      const other = await MongoMemoryServer.create()
      const conn = await mongoose.createConnection(other.getUri(mongoose.connection.name)).asPromise()
      try {
        const remote = conn.model('KDoc', KSchema)
        await remote.create({ a: 1, name: 'other-deployment' })

        await KModel.find({ a: 1 }).lean().cache()
        const fromRemote = await remote.find({ a: 1 }).lean().cache()

        expect(fromRemote.map((d) => d.name)).toEqual(['other-deployment'])
      } finally {
        await conn.close()
        await other.stop()
      }
    })

    it('serves each collection its own rows for the same model name', async () => {
      const conn = await mongoose.createConnection(sameDatabaseUri()).asPromise()
      try {
        const archive = conn.model('KDoc', KSchema, 'kdocs_archive')
        await archive.deleteMany({})
        await archive.create({ a: 1, name: 'archived' })

        await KModel.find({ a: 1 }).lean().cache()
        const fromArchive = await archive.find({ a: 1 }).lean().cache()

        expect(fromArchive.map((d) => d.name)).toEqual(['archived'])
      } finally {
        await conn.close()
      }
    })

    it('shares entries between two connections to the same database', async () => {
      const conn = await mongoose.createConnection(sameDatabaseUri()).asPromise()
      try {
        const twin = conn.model('KDoc', KSchema)
        await KModel.find({ a: 1 }).lean().cache()
        await KModel.updateMany({ a: 1 }, { name: 'changed' })

        const fromTwin = await twin.find({ a: 1 }).lean().cache()

        expect(fromTwin.map((d) => d.name)).toEqual(['x'])
      } finally {
        await conn.close()
      }
    })
  })

  describe('aggregate identity', () => {
    it('serves the same pipeline on another model that model result', async () => {
      await KOther.create([{ name: 'o1' }])
      await KModel.aggregate([{ $count: 'total' }]).cache()
      const other = await KOther.aggregate([{ $count: 'total' }]).cache()
      expect(other).toEqual([{ total: 1 }])
    })

    it('serves the same pipeline on another database that database result', async () => {
      const t1 = mongoose.connection.useDb('cache_key_tenant1').model('KDoc', KSchema)
      const t2 = mongoose.connection.useDb('cache_key_tenant2').model('KDoc', KSchema)
      await t1.deleteMany({})
      await t2.deleteMany({})
      await t1.create([{ a: 1 }, { a: 2 }])
      await t2.create({ a: 1 })

      await t1.aggregate([{ $count: 'total' }]).cache()
      const fromT2 = await t2.aggregate([{ $count: 'total' }]).cache()

      expect(fromT2).toEqual([{ total: 1 }])
    })

    it('serves a different collation its own result', async () => {
      await KOther.create([{ name: 'a' }, { name: 'A' }])
      const pipeline = () => [{ $match: { name: 'a' } }, { $count: 'total' }]

      await KOther.aggregate(pipeline()).cache()
      const insensitive = await KOther.aggregate(pipeline()).collation({ locale: 'en', strength: 2 }).cache()

      expect(insensitive).toEqual([{ total: 2 }])
    })

    it('still hits the cache for the same pipeline on the same model', async () => {
      await KOther.create([{ name: 'o1' }])
      await KOther.aggregate([{ $count: 'total' }]).cache()
      await KOther.create([{ name: 'o2' }])
      const hit = await KOther.aggregate([{ $count: 'total' }]).cache()
      expect(hit).toEqual([{ total: 1 }])
    })
  })

  describe('aggregate without a model', () => {
    it('rejects with the same error as without .cache()', async () => {
      const uncached = await new mongoose.Aggregate()
        .append({ $match: {} })
        .exec()
        .catch((err: Error) => err)
      const cached = await new mongoose.Aggregate()
        .append({ $match: {} })
        .cache()
        .exec()
        .catch((err: Error) => err)
      expect(uncached).toBeInstanceOf(Error)
      expect(cached).toBeInstanceOf((uncached as Error).constructor)
      expect((cached as Error).message).toBe((uncached as Error).message)
    })
  })

  describe('sort order', () => {
    it('serves sort({ b, a }) its own order after sort({ a, b }) was cached', async () => {
      await KModel.find().sort({ a: 1, b: 1 }).lean().cache()
      const cached = await KModel.find().sort({ b: 1, a: 1 }).lean().cache()
      expect(cached.map((d) => d.name)).toEqual(['y', 'x', 'z', 'w'])
    })

    it('serves an aggregate $sort its own order after the reversed $sort was cached', async () => {
      await KModel.aggregate([{ $sort: { a: 1, b: 1 } }, { $project: { _id: 0, name: 1 } }]).cache()
      const cached = await KModel.aggregate([{ $sort: { b: 1, a: 1 } }, { $project: { _id: 0, name: 1 } }]).cache()
      expect(cached.map((d) => d.name)).toEqual(['y', 'x', 'z', 'w'])
    })

    it('serves a reversed sort direction its own order', async () => {
      await KModel.find().sort({ a: 1 }).lean().cache()
      const cached = await KModel.find().sort({ a: -1 }).lean().cache()
      expect(cached.map((d) => d.name)).toEqual(['w', 'z', 'y', 'x'])
    })
  })

  describe('value types', () => {
    it('serves find({ name: undefined }) its own rows after find({}) was cached', async () => {
      const undefinedName: Record<string, unknown> = { name: undefined }
      const real = await KModel.find(undefinedName).lean()
      await KModel.find({}).lean().cache()
      const cached = await KModel.find(undefinedName).lean().cache()
      expect(cached.length).toBe(real.length)
    })

    it('serves an ObjectId hex string its own rows after the ObjectId was cached', async () => {
      await KModel.find({ m: new mongoose.Types.ObjectId(OID) })
        .lean()
        .cache()
      const cached = await KModel.find({ m: OID }).lean().cache()
      expect(cached.map((d) => d.name)).toEqual(['y'])
    })

    it('serves an ISO date string its own rows after the Date was cached', async () => {
      await KModel.find({ m: new Date(ISO) })
        .lean()
        .cache()
      const cached = await KModel.find({ m: ISO }).lean().cache()
      expect(cached.map((d) => d.name)).toEqual(['w'])
    })

    it('serves find({ name: null }) its own rows after find({}) was cached', async () => {
      const real = await KModel.find({ name: null }).lean()
      await KModel.find({}).lean().cache()
      const cached = await KModel.find({ name: null }).lean().cache()
      expect(cached.length).toBe(real.length)
    })
  })

  describe('queries that only fail because of the cache key', () => {
    it.skipIf(!supportsBigInt)('resolves a BigInt filter', async () => {
      await expect(bigIntModel().find({ big: 5n }).lean().cache()).resolves.toEqual([])
    })

    it.skipIf(!supportsBigInt)('resolves the same BigInt filter without .cache()', async () => {
      await expect(bigIntModel().find({ big: 5n }).lean()).resolves.toEqual([])
    })

    it('resolves a query inside a session', async () => {
      const session = await mongoose.startSession()
      try {
        await expect(KModel.find({ a: 1 }).session(session).lean().cache()).resolves.toHaveLength(1)
      } finally {
        await session.endSession()
      }
    })

    it('resolves an aggregate inside a session', async () => {
      const session = await mongoose.startSession()
      try {
        await expect(
          KModel.aggregate([{ $match: { a: 1 } }])
            .session(session)
            .cache(),
        ).resolves.toHaveLength(1)
      } finally {
        await session.endSession()
      }
    })

    it('reads a query inside a session from the database and does not cache it', async () => {
      await KModel.find({ a: 1 }).lean().cache()
      await KModel.updateMany({ a: 1 }, { name: 'changed' })
      const session = await mongoose.startSession()
      try {
        const inSession = await KModel.find({ a: 1 }).session(session).lean().cache()
        expect(inSession.map((d) => d.name)).toEqual(['changed'])
      } finally {
        await session.endSession()
      }
      const outside = await KModel.find({ a: 1 }).lean().cache()
      expect(outside.map((d) => d.name)).toEqual(['x'])
    })

    it('reads an aggregate inside a session from the database and does not cache it', async () => {
      const pipeline = () => [{ $match: { a: 1 } }, { $project: { _id: 0, name: 1 } }]
      await KModel.aggregate(pipeline()).cache()
      await KModel.updateMany({ a: 1 }, { name: 'changed' })
      const session = await mongoose.startSession()
      try {
        const inSession = await KModel.aggregate(pipeline()).session(session).cache()
        expect(inSession).toEqual([{ name: 'changed' }])
      } finally {
        await session.endSession()
      }
      const outside = await KModel.aggregate(pipeline()).cache()
      expect(outside).toEqual([{ name: 'x' }])
    })

    it('derives the same key with or without a session', async () => {
      const session = await mongoose.startSession()
      try {
        expect(KModel.find({ a: 1 }).session(session).cache().getCacheKey()).toBe(KModel.find({ a: 1 }).cache().getCacheKey())
        expect(
          KModel.aggregate([{ $match: { a: 1 } }])
            .session(session)
            .cache()
            .getCacheKey(),
        ).toBe(
          KModel.aggregate([{ $match: { a: 1 } }])
            .cache()
            .getCacheKey(),
        )
      } finally {
        await session.endSession()
      }
    })

    it('resolves the same session query without .cache()', async () => {
      const session = await mongoose.startSession()
      try {
        await expect(KModel.find({ a: 1 }).session(session).lean()).resolves.toHaveLength(1)
      } finally {
        await session.endSession()
      }
    })
  })
})
