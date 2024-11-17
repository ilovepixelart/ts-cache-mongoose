import fs from 'node:fs'
import { MongoMemoryServer } from 'mongodb-memory-server'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'

import mongoose, { model } from 'mongoose'
import CacheMongoose from '../src/plugin'

import User from './models/User'

describe('cache-memory', async () => {
  let mongo: MongoMemoryServer
  let cache: CacheMongoose
  const dbName = 'cache-memory'
  const dbPath = `./tests/mongo/${dbName}`

  beforeAll(async () => {
    cache = CacheMongoose.init(mongoose, {
      engine: 'memory',
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
    await mongoose.connection.collection('users').deleteMany({})
  })

  describe('memory scenarios', () => {
    it('should use memory cache', async () => {
      const user = await User.create({
        name: 'John Doe',
        role: 'admin',
      })

      const user1 = await User.findById(user._id).cache().exec()
      await User.findOneAndUpdate({ _id: user._id }, { name: 'John Doe 2' }).exec()
      const user2 = await User.findById(user._id).cache().exec()

      expect(user1).not.toBeNull()
      expect(user2).not.toBeNull()
      expect(user1?._id.toString()).toBe(user2?._id.toString())
      expect(user1?.name).toEqual(user2?.name)
    })

    it('should not use cache', async () => {
      const user = await User.create({
        name: 'John Doe',
        role: 'admin',
      })

      const cache1 = await User.findById(user._id).cache().exec()
      await User.findByIdAndUpdate(user._id, { name: 'John Doe 2' }).exec()
      await cache.clear()
      const cache2 = await User.findById(user._id).cache().exec()

      expect(cache1).not.toBeNull()
      expect(cache2).not.toBeNull()
      expect(cache1?._id.toString()).toBe(cache2?._id.toString())
      expect(cache1?.name).not.toEqual(cache2?.name)
    })

    it('should use memory cache with custom key', async () => {
      const user = await User.create({
        name: 'John Doe',
        role: 'admin',
      })

      const cache1 = await User.findById(user._id).cache('1 minute', 'test-custom-key').exec()
      await User.findOneAndUpdate({ _id: user._id }, { name: 'John Doe 2' }).exec()
      const cache2 = await User.findById(user._id).cache('1 minute', 'test-custom-key').exec()

      expect(cache1).not.toBeNull()
      expect(cache2).not.toBeNull()
      expect(cache1?._id.toString()).toBe(cache2?._id.toString())
      expect(cache1?.name).toEqual(cache2?.name)
    })

    it('should use memory cache and clear custom key', async () => {
      const user = await User.create({
        name: 'John Doe',
        role: 'admin',
      })

      const cache1 = await User.findById(user._id).cache('1 minute', 'test-custom-key-second').exec()
      await User.updateOne({ _id: user._id }, { name: 'John Doe 2' }).exec()
      await cache.clear('test-custom-key-second')
      const cache2 = await User.findById(user._id).cache('1 minute', 'test-custom-key-second').exec()

      expect(cache1).not.toBeNull()
      expect(cache2).not.toBeNull()
      expect(cache1?._id.toString()).toBe(cache2?._id.toString())
      expect(cache1?.name).not.toEqual(cache2?.name)
    })

    it('should use memory cache and custom key with an empty string', async () => {
      const user = await User.create({
        name: 'John Doe',
        role: 'admin',
      })

      const cache1 = await User.findById(user._id).cache('1 minute', '').exec()
      await User.updateOne({ _id: user._id }, { name: 'John Doe 2' }).exec()
      const cache2 = await User.findById(user._id).cache('1 minute', '').exec()

      expect(cache1).not.toBeNull()
      expect(cache2).not.toBeNull()
      expect(cache1?._id.toString()).toBe(cache2?._id.toString())
      expect(cache1?.name).toEqual(cache2?.name)

      await cache.clear('')
      const cache3 = await User.findById(user._id).cache('1 minute', '').exec()
      expect(cache3).not.toBeNull()
      expect(cache2?._id.toString()).toBe(cache3?._id.toString())
      expect(cache2?.name).not.toEqual(cache3?.name)
    })

    it('should use memory cache and aggregate', async () => {
      await User.create([
        { name: 'John', role: 'admin' },
        { name: 'Bob', role: 'admin' },
        { name: 'Alice', role: 'user' },
      ])

      const cache1 = await User.aggregate([{ $match: { role: 'admin' } }, { $group: { _id: '$role', count: { $sum: 1 } } }])
        .cache()
        .exec()

      await User.create({ name: 'Mark', role: 'admin' })

      const cache2 = await User.aggregate([{ $match: { role: 'admin' } }, { $group: { _id: '$role', count: { $sum: 1 } } }])
        .cache()
        .exec()

      expect(cache1).not.toBeNull()
      expect(cache2).not.toBeNull()
      expect(cache1?.[0].count).toEqual(cache2?.[0].count)
    })
  })

  describe('memory scenarios with ttl', () => {
    const users = [
      { name: 'John', age: 30, role: 'admin' },
      { name: 'Alice', age: 25, role: 'user' },
      { name: 'Bob', age: 35, role: 'user' },
    ]

    beforeEach(async () => {
      // Delete all users before each test
      await User.deleteMany().exec()

      // Create new users
      await User.create(users)
    })

    it('findById', async () => {
      const john = await User.create({ name: 'John', age: 30, role: 'admin' })
      const user = await User.findById(john._id).cache('1 minute').exec()
      const cachedUser = await User.findById(john._id).cache('1 minute').exec()

      expect(user?._id.toString()).toBe(cachedUser?._id.toString())
      expect(user?.name).toEqual(cachedUser?.name)
      expect(user?.createdAt).toEqual(cachedUser?.createdAt)
      expect(user?.updatedAt).toEqual(cachedUser?.updatedAt)
    })

    it('findOne', async () => {
      const user = await User.findOne({ name: 'John', age: 30, role: 'admin' }).cache('1 minute').exec()
      await User.create({ name: 'Steve', age: 30, role: 'admin' })
      const cachedUser = await User.findOne({
        name: 'John',
        age: 30,
        role: 'admin',
      })
        .cache('1 minute')
        .exec()

      expect(user?._id.toString()).toBe(cachedUser?._id.toString())
      expect(user?.name).toEqual(cachedUser?.name)
      expect(user?.createdAt).toEqual(cachedUser?.createdAt)
      expect(user?.updatedAt).toEqual(cachedUser?.updatedAt)
    })

    it('find', async () => {
      const users = await User.find({ age: { $gte: 30 } })
        .cache('1 minute')
        .exec()
      await User.create({ name: 'Steve', age: 30, role: 'admin' })
      const cachedUsers = await User.find({ age: { $gte: 30 } })
        .cache('1 minute')
        .exec()

      expect(users).toHaveLength(cachedUsers.length)
    })

    it('count', async () => {
      const count = await User.countDocuments({ age: { $gte: 30 } })
        .cache('1 minute')
        .exec()
      await User.create({ name: 'Steve', age: 30, role: 'admin' })
      const cachedCount = await User.countDocuments({ age: { $gte: 30 } })
        .cache('1 minute')
        .exec()

      expect(count).toEqual(cachedCount)
    })

    it('distinct', async () => {
      const emails = await User.distinct('name').cache('1 minute').exec()
      await User.create({ name: 'Steve', age: 30, role: 'admin' })
      const cachedEmails = await User.distinct('name').cache('1 minute').exec()

      expect(emails).toEqual(cachedEmails)
    })
  })
})
