import fs from 'node:fs'
import { MongoMemoryServer } from 'mongodb-memory-server'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

import mongoose, { model } from 'mongoose'
import CacheMongoose from '../src/plugin'

import User from './models/User'

describe('cache-debug', async () => {
  let mongo: MongoMemoryServer
  let cache: CacheMongoose
  const dbName = 'cache-debug'
  const dbPath = `./tests/mongo/${dbName}`

  beforeAll(async () => {
    cache = CacheMongoose.init(mongoose, {
      engine: 'memory',
      debug: true,
    })

    fs.mkdirSync(dbPath, { recursive: true })
    mongo = await MongoMemoryServer.create({
      instance: {
        dbName,
        dbPath,
      },
    })

    const uri = mongo.getUri()
    await mongoose.connect(uri)
    await cache.clear()
  })

  afterAll(async () => {
    await cache.close()
    await mongoose.connection.dropDatabase()
    await mongoose.connection.close()
    await mongo.stop({ doCleanup: true, force: true })
    try {
      fs.rmdirSync(dbPath, { recursive: true })
    } catch {
      // Folder is already deleted
    }
  })

  beforeEach(async () => {
    vi.spyOn(global.console, 'log')
    await mongoose.connection.collection('users').deleteMany({})
  })

  afterEach(async () => {
    vi.restoreAllMocks()
  })

  describe('debug scenarios', () => {
    it('should create a use and and query it two time first is cache miss second is hit, also clear by key and global', async () => {
      const user = await User.create({
        name: 'John Doe',
        role: 'admin',
      })

      const key = 'key'
      const ttl = '1 second'
      const cacheMissRegExp = /\[ts-cache-mongoose\] GET '.*?' - MISS/
      const cacheHitRegExp = /\[ts-cache-mongoose\] GET '.*?' - HIT/
      const cacheSetRegExp = /\[ts-cache-mongoose\] SET '.*?' - ttl: \d+ ms/
      const cacheClearRegExp = /\[ts-cache-mongoose\] CLEAR/
      const cacheDelRegExp = /\[ts-cache-mongoose\] DEL '.*?'/

      const userCacheMiss = await User.findById(user._id).cache(ttl, key).exec()
      expect(console.log).toHaveBeenCalledWith(expect.stringMatching(cacheMissRegExp))
      expect(userCacheMiss).not.toBeNull()
      expect(userCacheMiss?._id.toString()).toBe(user._id.toString())
      expect(userCacheMiss?.name).toEqual(user.name)
      expect(userCacheMiss?.role).toEqual(user.role)

      const userCacheHit = await User.findById(user._id).cache(ttl, key).exec()
      expect(console.log).toHaveBeenCalledWith(expect.stringMatching(cacheSetRegExp))
      expect(console.log).toHaveBeenCalledWith(expect.stringMatching(cacheHitRegExp))
      expect(userCacheHit).not.toBeNull()
      expect(userCacheHit?._id.toString()).toBe(user._id.toString())
      expect(userCacheHit?.name).toEqual(user.name)
      expect(userCacheHit?.role).toEqual(user.role)

      await cache.clear(key)
      expect(console.log).toHaveBeenCalledWith(expect.stringMatching(cacheDelRegExp))

      await cache.clear()
      expect(console.log).toHaveBeenCalledWith(expect.stringMatching(cacheClearRegExp))
    })
  })
})
