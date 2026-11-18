import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import mongoose, { Schema } from 'mongoose'
import CacheMongoose from '../src/index'
import { getModelScope } from '../src/key'
import { server } from './mongo/server'

import type { Model } from 'mongoose'

const scopeOf = (model: unknown) => getModelScope(model as Model<unknown> | undefined)
const baseUri = () => `mongodb://${mongoose.connection.host}:${mongoose.connection.port}`

describe('cache key scope of an open connection', () => {
  const instance = server('cache-key-scope')
  const SModel = mongoose.model('KeyScope', new Schema({ name: String }))
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

  it('is the model, collection, database, host and port', () => {
    expect(scopeOf(SModel)).toEqual({
      model: 'KeyScope',
      collection: SModel.collection.collectionName,
      db: mongoose.connection.name,
      host: mongoose.connection.host,
      port: mongoose.connection.port,
    })
  })

  it('is empty without a model', () => {
    expect(scopeOf(undefined)).toEqual({})
  })

  it('gives the same query the same key on two open connections to the same database', async () => {
    const conn = await mongoose.createConnection(`${baseUri()}/${mongoose.connection.name}`).asPromise()
    try {
      const other = conn.model('KeyScope', SModel.schema)
      expect(other.find({ name: 'a' }).cache().getCacheKey()).toBe(SModel.find({ name: 'a' }).cache().getCacheKey())
    } finally {
      await conn.close()
    }
  })

  it('gives a useDb connection of an open connection a key of its own database', () => {
    const tenant = mongoose.connection.useDb('cache_key_scope_tenant').model('KeyScope', SModel.schema)
    expect(scopeOf(tenant)).toMatchObject({ db: 'cache_key_scope_tenant', host: mongoose.connection.host, port: mongoose.connection.port })
    expect(tenant.find({ name: 'a' }).cache().getCacheKey()).not.toBe(SModel.find({ name: 'a' }).cache().getCacheKey())
  })
})
