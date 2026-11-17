import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'

import { EJSON } from 'bson'
import IORedis from 'ioredis'
import mongoose, { Schema } from 'mongoose'
import CacheMongoose from '../src/index'
import { server } from './mongo/server'

// The persisted shape of Redis entries: what another process, or another version of this
// package, reads back under the same key. Writes and FLUSHDBs db 12, so it runs only
// against a Redis named explicitly through REDIS_PORT.
const redisPort = process.env.REDIS_PORT

const EntryModel = mongoose.model('REntryDoc', new Schema({ name: String, n: Number, when: Date }))

describe.skipIf(!redisPort)('cache entry contract (redis)', () => {
  const instance = server('cache-redis-entry-contract')
  const connection = { host: process.env.REDIS_HOST ?? 'localhost', port: Number(redisPort), db: 12 }
  const raw = new IORedis({ ...connection, lazyConnect: true })
  let cache: CacheMongoose

  beforeAll(async () => {
    cache = CacheMongoose.init(mongoose, { engine: 'redis', engineOptions: { ...connection, keyPrefix: 'entry:' } })
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
    await EntryModel.deleteMany({})
    await EntryModel.create({ name: 'x', n: 1, when: new Date('2024-01-02T00:00:00Z') })
  })

  it('stores a lean find as the relaxed EJSON of its result', async () => {
    const result = await EntryModel.find({ n: 1 }).lean().cache('1 minute', 'lean-find')
    expect(await raw.get('entry:lean-find')).toBe(EJSON.stringify(result))
  })

  it('stores an aggregate as the relaxed EJSON of its result', async () => {
    const result = await EntryModel.aggregate([{ $match: { n: 1 } }, { $project: { _id: 0, name: 1 } }]).cache('1 minute', 'agg')
    expect(await raw.get('entry:agg')).toBe(EJSON.stringify(result))
  })

  it('stores a count as its number', async () => {
    await EntryModel.countDocuments({ n: 1 }).cache('1 minute', 'count')
    expect(await raw.get('entry:count')).toBe('1')
  })
})
