import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

import mongoose from 'mongoose'
import CacheMongoose from '../src'
import { UserModel } from './models/User'
import { server } from './mongo/server'

describe('cache-debug', async () => {
  const instance = server('cache-debug')
  let cache: CacheMongoose

  beforeAll(async () => {
    cache = CacheMongoose.init(mongoose, {
      engine: 'memory',
      debug: true,
    })

    await instance.create()
  })

  afterAll(async () => {
    await cache.clear()
    await cache.close()
    await instance.destroy()
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
      const user = await UserModel.create({
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

      const userCacheMiss = await UserModel.findById(user._id).cache(ttl, key).exec()
      expect(console.log).toHaveBeenCalledWith(expect.stringMatching(cacheMissRegExp))
      expect(userCacheMiss).not.toBeNull()
      expect(userCacheMiss?._id.toString()).toBe(user._id.toString())
      expect(userCacheMiss?.name).toEqual(user.name)
      expect(userCacheMiss?.role).toEqual(user.role)

      const userCacheHit = await UserModel.findById(user._id).cache(ttl, key).exec()
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
