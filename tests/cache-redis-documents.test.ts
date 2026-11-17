import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'

import IORedis from 'ioredis'
import mongoose, { Schema } from 'mongoose'
import CacheMongoose from '../src/index'
import { server } from './mongo/server'

// A non-lean result is stored as document data, in the shape of the lean result of the same
// query, not as a serialized mongoose document. Writes and FLUSHDBs db 13, so it runs only
// against a Redis named explicitly through REDIS_PORT.
const redisPort = process.env.REDIS_PORT

const DocModel = mongoose.model('RDocEntry', new Schema({ name: String, n: Number, tags: [String], when: Date }))

describe.skipIf(!redisPort)('non-lean entries (redis)', () => {
  const instance = server('cache-redis-documents')
  const connection = { host: process.env.REDIS_HOST ?? 'localhost', port: Number(redisPort), db: 13 }
  const raw = new IORedis({ ...connection, lazyConnect: true })
  let cache: CacheMongoose

  beforeAll(async () => {
    cache = CacheMongoose.init(mongoose, { engine: 'redis', engineOptions: { ...connection, keyPrefix: 'docs:' } })
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
    await DocModel.deleteMany({})
    await DocModel.create({ name: 'x', n: 1, tags: ['a'], when: new Date('2024-01-02T00:00:00Z') })
  })

  it('stores a non-lean findOne in the shape of the lean findOne', async () => {
    await DocModel.findOne({ n: 1 }).lean().cache('1 minute', 'lean-one')
    await DocModel.findOne({ n: 1 }).cache('1 minute', 'doc-one')
    expect(await raw.get('docs:doc-one')).toBe(await raw.get('docs:lean-one'))
  })

  it('stores a non-lean find in the shape of the lean find', async () => {
    await DocModel.find({ n: 1 }).lean().cache('1 minute', 'lean-many')
    await DocModel.find({ n: 1 }).cache('1 minute', 'doc-many')
    expect(await raw.get('docs:doc-many')).toBe(await raw.get('docs:lean-many'))
  })
})
