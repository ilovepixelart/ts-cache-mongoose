import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'

import { MongoMemoryServer } from 'mongodb-memory-server'
import mongoose, { Schema } from 'mongoose'
import CacheMongoose from '../src/index'
import { server } from './mongo/server'

// A query on a connection that is not open yet is buffered by mongoose until it opens, but its
// cache key is taken when it is executed, before the connection knows its database and host.

const CSchema = new Schema({ name: String })
const baseUri = () => `mongodb://${mongoose.connection.host}:${mongoose.connection.port}`
const names = (docs: { name?: string | null }[]) => docs.map((d) => d.name)

describe('cache key of a connection that is not open yet', () => {
  const instance = server('cache-key-connection')
  let cache: CacheMongoose

  beforeAll(async () => {
    cache = CacheMongoose.init(mongoose, { engine: 'memory' })
    await instance.create()
    for (const db of ['cache_conn_a', 'cache_conn_b']) {
      const conn = mongoose.connection.useDb(db)
      await conn.collection('conndocs').deleteMany({})
      await conn.collection('conndocs').insertOne({ name: db })
    }
  })

  afterAll(async () => {
    await cache.clear()
    await cache.close()
    for (const db of ['cache_conn_a', 'cache_conn_b']) await mongoose.connection.useDb(db).dropDatabase()
    await instance.destroy()
  })

  beforeEach(async () => {
    await cache.clear()
  })

  it('serves each database its own rows when queried on createConnection() before openUri', async () => {
    const a = mongoose.createConnection()
    const b = mongoose.createConnection()
    try {
      const pa = a.model('ConnDoc', CSchema, 'conndocs').find().lean().cache().exec()
      await a.openUri(`${baseUri()}/cache_conn_a`)
      const first = await pa
      const pb = b.model('ConnDoc', CSchema, 'conndocs').find().lean().cache().exec()
      await b.openUri(`${baseUri()}/cache_conn_b`)
      const second = await pb

      expect(names(first)).toEqual(['cache_conn_a'])
      expect(names(second)).toEqual(['cache_conn_b'])
    } finally {
      await a.close()
      await b.close()
    }
  })

  it('serves each deployment its own rows for useDb of the same name before the connections open', async () => {
    const other = await MongoMemoryServer.create()
    const a = mongoose.createConnection()
    const b = mongoose.createConnection()
    try {
      const pa = a.useDb('cache_conn_a').model('ConnDoc', CSchema, 'conndocs').find().lean().cache().exec()
      await a.openUri(`${baseUri()}/cache_conn_other`)
      const first = await pa
      const pb = b.useDb('cache_conn_a').model('ConnDoc', CSchema, 'conndocs').find().lean().cache().exec()
      await b.openUri(other.getUri('cache_conn_other'))
      const second = await pb

      expect(names(first)).toEqual(['cache_conn_a'])
      expect(second).toEqual([])
    } finally {
      await a.close()
      await b.close()
      await other.stop({ doCleanup: true, force: true })
    }
  })

  it('serves each database its own rows for useDb before the connection opens', async () => {
    const base = mongoose.createConnection()
    try {
      const pa = base.useDb('cache_conn_a').model('ConnDoc', CSchema, 'conndocs').find().lean().cache().exec()
      await base.openUri(`${baseUri()}/cache_conn_other`)
      const first = await pa
      const second = await base.useDb('cache_conn_b').model('ConnDoc', CSchema, 'conndocs').find().lean().cache()

      expect(names(first)).toEqual(['cache_conn_a'])
      expect(names(second)).toEqual(['cache_conn_b'])
    } finally {
      await base.close()
    }
  })

  it('gives the same query on one connection that is not open yet one key, and on another connection another', async () => {
    const a = mongoose.createConnection()
    const b = mongoose.createConnection()
    const key = (conn: mongoose.Connection) => conn.model('ConnDoc', CSchema, 'conndocs').find({ name: 'x' }).cache().getCacheKey()

    expect(key(a)).toBe(key(a))
    expect(key(a)).not.toBe(key(b))
    await a.close()
    await b.close()
  })

  it('hits the cache once the connection is open', async () => {
    const conn = mongoose.createConnection()
    try {
      const model = conn.model('ConnDoc', CSchema, 'conndocs')
      const pending = model.find().lean().cache().exec()
      await conn.openUri(`${baseUri()}/cache_conn_a`)
      await pending
      await model.find().lean().cache()
      await mongoose.connection
        .useDb('cache_conn_a')
        .collection('conndocs')
        .updateMany({}, { $set: { name: 'changed' } })
      const hit = await model.find().lean().cache()

      expect(names(hit)).toEqual(['cache_conn_a'])
    } finally {
      await mongoose.connection
        .useDb('cache_conn_a')
        .collection('conndocs')
        .updateMany({}, { $set: { name: 'cache_conn_a' } })
      await conn.close()
    }
  })
})
