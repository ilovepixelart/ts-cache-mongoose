import mongoose, { model } from 'mongoose'
import CacheMongoose from '../src/plugin'

import UserSchema from './schemas/UserSchema'

describe('CacheMongoose', () => {
  const uri = `${globalThis.__MONGO_URI__}${globalThis.__MONGO_DB_NAME__}`
  const User = model('User', UserSchema)

  const cache = CacheMongoose.init(mongoose, {
    engine: 'memory',
    debug: true,
  })

  beforeAll(async () => {
    await mongoose.connect(uri)
    await cache.clear()
  })

  afterAll(async () => {
    await mongoose.connection.close()
    await cache.close()
  })

  beforeEach(async () => {
    jest.spyOn(global.console, 'log')
    await mongoose.connection.collection('users').deleteMany({})
  })

  afterEach(async () => {
    jest.restoreAllMocks()
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
      expect(userCacheMiss?._id).toEqual(user._id)
      expect(userCacheMiss?.name).toEqual(user.name)
      expect(userCacheMiss?.role).toEqual(user.role)

      const userCacheHit = await User.findById(user._id).cache(ttl, key).exec()
      expect(console.log).toHaveBeenCalledWith(expect.stringMatching(cacheSetRegExp))
      expect(console.log).toHaveBeenCalledWith(expect.stringMatching(cacheHitRegExp))
      expect(userCacheHit).not.toBeNull()
      expect(userCacheHit?._id).toEqual(user._id)
      expect(userCacheHit?.name).toEqual(user.name)
      expect(userCacheHit?.role).toEqual(user.role)

      await cache.clear(key)
      expect(console.log).toHaveBeenCalledWith(expect.stringMatching(cacheDelRegExp))

      await cache.clear()
      expect(console.log).toHaveBeenCalledWith(expect.stringMatching(cacheClearRegExp))
    })
  })
})
