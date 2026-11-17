import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'

import IORedis from 'ioredis'
import mongoose, { Schema } from 'mongoose'
import CacheMongoose from '../src/index'
import { server } from './mongo/server'

// Writes and FLUSHDBs db 11, so it runs only against a Redis named explicitly through REDIS_PORT.
const redisPort = process.env.REDIS_PORT

const RModel = mongoose.model('RKeyDoc', new Schema({ a: Number, name: String }))

describe.skipIf(!redisPort)('cache key contract (redis)', () => {
  const instance = server('cache-key-redis-contract')
  const connection = { host: process.env.REDIS_HOST ?? 'localhost', port: Number(redisPort), db: 11 }
  const raw = new IORedis({ ...connection, lazyConnect: true })
  let cache: CacheMongoose

  beforeAll(async () => {
    cache = CacheMongoose.init(mongoose, { engine: 'redis', engineOptions: { ...connection, keyPrefix: 'contract:' } })
    await instance.create()
  })

  afterAll(async () => {
    await raw.flushdb()
    await raw.quit()
    await cache.close()
    await instance.destroy()
  })

  beforeEach(async () => {
    await raw.flushdb()
    await RModel.deleteMany({})
    await RModel.create({ a: 1, name: 'x' })
  })

  it('stores a query under the key prefix followed by its generated key', async () => {
    const query = RModel.find({ a: 1 }).lean().cache()
    const key = query.getCacheKey()
    await query
    expect(await raw.keys('*')).toEqual([`contract:${key}`])
  })

  it('stores an aggregate under the key prefix followed by its generated key', async () => {
    const aggregate = RModel.aggregate([{ $match: { a: 1 } }]).cache()
    const key = aggregate.getCacheKey()
    await aggregate
    expect(await raw.keys('*')).toEqual([`contract:${key}`])
  })

  it('stores a custom key verbatim under the key prefix', async () => {
    await RModel.find({ a: 1 }).lean().cache('1 minute', 'user-key')
    expect(await raw.keys('*')).toEqual(['contract:user-key'])
  })
})
