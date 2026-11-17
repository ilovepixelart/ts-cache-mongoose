import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'

import { MongoMemoryReplSet } from 'mongodb-memory-server'
import mongoose, { Schema } from 'mongoose'
import CacheMongoose from '../src/index'

// mongoose 8.4 added transactionAsyncLocalStorage: inside connection.transaction() every
// operation runs in the transaction's session without an explicit .session().
const [major = 0, minor = 0] = mongoose.version.split('.').map(Number)
const supportsImplicitSession = major > 8 || (major === 8 && minor >= 4)

const TModel = mongoose.model('TDoc', new Schema({ a: Number, name: String }))
const pipeline = () => [{ $match: { a: 1 } }, { $project: { _id: 0, name: 1 } }]
const names = (rows: { name?: string | null }[]) => rows.map((d) => d.name)

describe.skipIf(!supportsImplicitSession)('cache inside a transaction with an implicit session', () => {
  let replSet: MongoMemoryReplSet
  let cache: CacheMongoose

  beforeAll(async () => {
    mongoose.set('transactionAsyncLocalStorage', true)
    cache = CacheMongoose.init(mongoose, { engine: 'memory' })
    replSet = await MongoMemoryReplSet.create({ replSet: { count: 1 } })
    await mongoose.connect(replSet.getUri('cache-transaction'))
    await TModel.createCollection()
  })

  afterAll(async () => {
    await cache.clear()
    await cache.close()
    await mongoose.disconnect()
    await replSet.stop()
    mongoose.set('transactionAsyncLocalStorage', false)
  })

  beforeEach(async () => {
    await TModel.deleteMany({})
    await cache.clear()
    await TModel.create({ a: 1, name: 'committed' })
  })

  const abortedTransaction = async (fn: () => Promise<void>) => {
    await expect(
      mongoose.connection.transaction(async () => {
        await fn()
        throw new Error('abort')
      }),
    ).rejects.toThrow('abort')
  }

  it('does not serve a query result read inside an aborted transaction', async () => {
    await abortedTransaction(async () => {
      await TModel.updateMany({ a: 1 }, { name: 'uncommitted' })
      await TModel.find({ a: 1 }).lean().cache()
    })
    expect(names(await TModel.find({ a: 1 }).lean().cache())).toEqual(['committed'])
  })

  it('does not serve an aggregate result read inside an aborted transaction', async () => {
    await abortedTransaction(async () => {
      await TModel.updateMany({ a: 1 }, { name: 'uncommitted' })
      await TModel.aggregate(pipeline()).cache()
    })
    expect(names(await TModel.aggregate(pipeline()).cache())).toEqual(['committed'])
  })

  it('reads its own writes inside a transaction instead of a cached query result', async () => {
    await TModel.find({ a: 1 }).lean().cache()
    let inside: unknown[] = []
    await mongoose.connection.transaction(async () => {
      await TModel.updateMany({ a: 1 }, { name: 'changed' })
      inside = names(await TModel.find({ a: 1 }).lean().cache())
    })
    expect(inside).toEqual(['changed'])
  })

  it('reads its own writes inside a transaction instead of a cached aggregate result', async () => {
    await TModel.aggregate(pipeline()).cache()
    let inside: unknown[] = []
    await mongoose.connection.transaction(async () => {
      await TModel.updateMany({ a: 1 }, { name: 'changed' })
      inside = names(await TModel.aggregate(pipeline()).cache())
    })
    expect(inside).toEqual(['changed'])
  })

  it('still caches the same queries outside a transaction', async () => {
    await TModel.find({ a: 1 }).lean().cache()
    await TModel.aggregate(pipeline()).cache()
    await TModel.updateMany({ a: 1 }, { name: 'changed' })
    expect(names(await TModel.find({ a: 1 }).lean().cache())).toEqual(['committed'])
    expect(names(await TModel.aggregate(pipeline()).cache())).toEqual(['committed'])
  })

  it('caches a query and an aggregate that opt out of any session with session(null)', async () => {
    await TModel.find({ a: 1 }).session(null).lean().cache()
    await TModel.aggregate(pipeline()).session(null).cache()
    await TModel.updateMany({ a: 1 }, { name: 'changed' })
    expect(names(await TModel.find({ a: 1 }).session(null).lean().cache())).toEqual(['committed'])
    expect(names(await TModel.aggregate(pipeline()).session(null).cache())).toEqual(['committed'])
  })
})
