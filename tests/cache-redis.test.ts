import mongoose from 'mongoose'
import plugin from '../src/plugin'

import User from './models/User'
import Story from './models/Story'

describe('cache redis', () => {
  const uri = `${globalThis.__MONGO_URI__}${globalThis.__MONGO_DB_NAME__}`

  const cache = plugin.init(mongoose, {
    engine: 'redis',
    engineOptions: {
      host: 'localhost',
      port: 6379
    },
    defaultTTL: '10 seconds'
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
    await mongoose.connection.collection('users').deleteMany({})
    await mongoose.connection.collection('stories').deleteMany({})
  })

  it('should use cache', async () => {
    const user = await User.create({
      name: 'John Doe',
      role: 'admin'
    })

    const user1 = await User.findById(user._id).cache().exec()
    await User.findOneAndUpdate({ _id: user._id }, { name: 'John Doe 2' }).exec()
    const user2 = await User.findById(user._id).cache().exec()

    expect(user1).not.toBeNull()
    expect(user2).not.toBeNull()
    expect(user1?._id).toEqual(user2?._id)
    expect(user1?.name).toEqual(user2?.name)
  })

  it('should clear cache', async () => {
    const user = await User.create({
      name: 'John Doe',
      role: 'admin'
    })

    const cache1 = await User.findById(user._id).cache().exec()
    await User.findByIdAndUpdate(user._id, { name: 'Steve' }).exec()
    await cache.clear()
    const cache2 = await User.findById(user._id).cache().exec()

    expect(cache1).not.toBeNull()
    expect(cache2).not.toBeNull()
    expect(cache1?._id).toEqual(cache2?._id)
    expect(cache1?.name).not.toEqual(cache2?.name)
  })

  it('should use cache with custom-key-1', async () => {
    const user = await User.create({
      name: 'John Doe',
      role: 'admin'
    })

    const cache1 = await User.findById(user._id).cache('30 seconds', 'custom-key-1').exec()
    await User.findOneAndUpdate({ _id: user._id }, { name: 'John Doe 2' }).exec()
    const cache2 = await User.findById(user._id).cache('30 seconds', 'custom-key-1').exec()

    expect(cache1).not.toBeNull()
    expect(cache2).not.toBeNull()
    expect(cache1?._id).toEqual(cache2?._id)
    expect(cache1?.name).toEqual(cache2?.name)
  })

  it('should clear custom-key-2', async () => {
    const user = await User.create({
      name: 'John Doe',
      role: 'admin'
    })

    const cache1 = await User.findById(user._id).cache('30 seconds', 'custom-key-2').exec()
    await User.updateOne({ _id: user._id }, { name: 'Steve' }).exec()
    await cache.clear('custom-key-2')
    const cache2 = await User.findById(user._id).cache('30 seconds', 'custom-key-2').exec()

    expect(cache1).not.toBeNull()
    expect(cache2).not.toBeNull()
    expect(cache1?._id).toEqual(cache2?._id)
    expect(cache1?.name).not.toEqual(cache2?.name)
  })

  it('should use cache without cache options', async () => {
    expect(cache).toBeDefined()

    const user = await User.create({
      name: 'John Doe',
      role: 'admin'
    })

    const cache1 = await User.findById(user._id).cache().exec()
    await User.updateOne({ _id: user._id }, { name: 'John Doe 2' }).exec()
    const cache2 = await User.findById(user._id).cache().exec()

    expect(cache1).not.toBeNull()
    expect(cache2).not.toBeNull()
    expect(cache1?._id).toEqual(cache2?._id)
    expect(cache1?.name).toEqual(cache2?.name)

    await User.create([
      {
        name: 'Alice',
        role: 'admin'
      },
      {
        name: 'Bob',
        role: 'admin'
      }
    ])

    const cache3 = await User.find({ role: 'admin' }).cache().exec()
    await User.updateMany({ role: 'admin' }, { name: 'Steve' }).exec()
    const cache4 = await User.find({ role: 'admin' }).cache().exec()

    expect(cache3).not.toBeNull()
    expect(cache4).not.toBeNull()
    expect(cache3?.length).toEqual(cache4?.length)
    expect(cache3?.[0].name).toEqual(cache4?.[0].name)
  })

  it('should use cache on aggregate', async () => {
    await User.create([
      { name: 'John', role: 'admin' },
      { name: 'Bob', role: 'admin' },
      { name: 'Alice', role: 'user' }
    ])

    const cache1 = await User.aggregate([
      { $match: { role: 'admin' } },
      { $group: { _id: '$role', count: { $sum: 1 } } }
    ]).cache('30 seconds').exec()

    await User.create({ name: 'Mark', role: 'admin' })

    const cache2 = await User.aggregate([
      { $match: { role: 'admin' } },
      { $group: { _id: '$role', count: { $sum: 1 } } }
    ]).cache('30 seconds').exec()

    expect(cache1).not.toBeNull()
    expect(cache2).not.toBeNull()
    expect(cache1?.[0].count).toEqual(cache2?.[0].count)
  })

  it('should use cache on aggregate with custom-key', async () => {
    await User.create([
      { name: 'John', role: 'admin' },
      { name: 'Bob', role: 'admin' },
      { name: 'Alice', role: 'user' }
    ])

    const cache1 = await User.aggregate([
      { $match: { role: 'admin' } },
      { $group: { _id: '$role', count: { $sum: 1 } } }
    ]).cache('30 seconds', 'aggregate-custom-key').exec()

    await User.create({ name: 'Mark', role: 'admin' })

    const cache2 = await User.aggregate([
      { $match: { role: 'admin' } },
      { $group: { _id: '$role', count: { $sum: 1 } } }
    ]).cache('30 seconds', 'aggregate-custom-key').exec()

    // Don't use cache key
    const cache3 = await User.aggregate([
      { $match: { role: 'admin' } },
      { $group: { _id: '$role', count: { $sum: 1 } } }
    ]).exec()

    expect(cache1).not.toBeNull()
    expect(cache2).not.toBeNull()
    expect(cache3).not.toBeNull()
    expect(cache1?.[0].count).toEqual(cache2?.[0].count)
    expect(cache1?.[0].count).not.toEqual(cache3?.[0].count)
  })

  it('should test lean cache', async () => {
    await User.create([
      { name: 'John', role: 'admin' },
      { name: 'Bob', role: 'admin' },
      { name: 'Alice', role: 'user' }
    ])

    const cache1 = await User.find({ role: 'admin' }).lean().cache('30 seconds').exec()
    await User.create({ name: 'Mark', role: 'admin' })
    const cache2 = await User.find({ role: 'admin' }).lean().cache('30 seconds').exec()

    expect(cache1).not.toBeNull()
    expect(cache2).not.toBeNull()
    expect(cache1?.length).toEqual(cache2?.length)
  })

  it('should cache with regex query', async () => {
    await User.create([
      { name: 'John', role: 'admin' },
      { name: 'Alice', role: 'user' },
      { name: 'Andy', role: 'user' }
    ])

    const cache1 = await User.find({ name: /^J/ }).cache('30 seconds').exec()
    await User.create({ name: 'Jenifer', role: 'admin' })
    const cache2 = await User.find({ name: /^J/ }).cache('30 seconds').exec()

    expect(cache1).not.toBeNull()
    expect(cache2).not.toBeNull()
    expect(cache1?.length).toEqual(cache2?.length)

    const cache3 = await User.find({ name: /^A/ }).cache('30 seconds').exec()
    await User.create({ name: 'Alex', role: 'admin' })
    const cache4 = await User.find({ name: /^A/ }).cache('30 seconds').exec()

    expect(cache3).not.toBeNull()
    expect(cache4).not.toBeNull()
    expect(cache3?.length).toEqual(cache4?.length)
  })

  it('should findOne', async () => {
    await User.create([
      { name: 'C', role: 'admin' },
      { name: 'V', role: 'user' },
      { name: 'G', role: 'user' }
    ])

    const cache1 = await User.findOne({ name: 'G' }).lean().cache('30 seconds').exec()
    expect(cache1).not.toBeNull()
    expect(cache1?._id instanceof mongoose.Types.ObjectId).toBeTruthy()
    expect(cache1).toHaveProperty('name', 'G')

    const cache2 = await User.findOne({ name: 'G' }).lean().cache('30 seconds').exec()
    expect(cache2).not.toBeNull()
    expect(cache2?._id instanceof mongoose.Types.ObjectId).toBeTruthy()
    expect(cache2).toHaveProperty('name', 'G')
    expect(cache1).toEqual(cache2)

    const cache3 = await User.findOne({ name: 'G' }).lean().cache('30 seconds').exec()
    expect(cache3).not.toBeNull()
    expect(cache3).toHaveProperty('name', 'G')
    expect(cache2).toEqual(cache3)

    const cache4 = await User.findOne({ name: 'V' }).lean().cache('30 seconds').exec()
    expect(cache4).not.toBeNull()
    expect(cache4).toHaveProperty('name', 'V')
    expect(cache3).not.toEqual(cache4)

    const cache5 = await User.findOne({ name: 'O' }).lean().cache('30 seconds').exec()
    const cache6 = await User.findOne({ name: 'O' }).lean().cache('30 seconds').exec()
    expect(cache5).toBeNull()
    expect(cache6).toBeNull()
    expect(cache5).toEqual(cache6)
  })

  it('should distinct("_id") and distinct("role") and distinct("createdAt")', async () => {
    await User.create({ name: 'i', role: 'admin' })
    await User.create({ name: 'p', role: 'user' })
    await User.create({ name: 'm', role: 'user' })

    const cache1 = await User.distinct('_id').cache('30 seconds').exec()
    expect(cache1).not.toBeNull()
    expect(cache1?.length).toBe(3)

    const cache2 = await User.distinct('_id').cache('30 seconds').exec()
    expect(cache2).not.toBeNull()
    expect(cache2?.length).toBe(3)

    const cache4 = await User.distinct('role').cache('30 seconds').exec()
    expect(cache4).not.toBeNull()
    expect(cache4?.length).toBe(2)

    const cache5 = await User.distinct('role').cache('30 seconds').exec()
    expect(cache5).not.toBeNull()
    expect(cache5?.length).toBe(2)

    const cache6 = await User.distinct('createdAt').cache('30 seconds').exec()
    expect(cache6).not.toBeNull()
    expect(cache6?.length).toBe(3)
    const cache7 = await User.distinct('createdAt').cache('30 seconds').exec()

    expect(cache1).toEqual(cache2)
    expect(cache4).toEqual(cache5)
    expect(cache6).toEqual(cache7)
  })

  it('should test exceptions', async () => {
    const user = await User.create({ name: 'i', role: 'admin' })
    const story1 = await Story.create({ title: '1', userId: user._id })
    const story2 = await Story.create({ title: '2', userId: user._id })

    const cache1 = await User.findOne({ name: 'i' }).populate({ path: 'stories' }).lean().cache('30 seconds').exec()
    const cache2 = await User.findOne({ name: 'i' }).populate({ path: 'stories' }).lean().cache('30 seconds').exec()
    expect(cache1).not.toBeNull()
    expect(cache1?.stories).not.toBeNull()
    expect(cache1?.stories?.length).toBe(2)
    expect(cache1?.stories?.[0]._id).toEqual(story1._id)
    expect(cache1?.stories?.[1]._id).toEqual(story2._id)
    expect(cache1).toEqual(cache2)
  })

  it('should not misclassify certain fields as objectIds', async () => {
    // ObjectId.isValid will return true for multiple scenarios.
    // A string being a potentially valid objectId should not be the
    // determining factor on wether or not deserialize it as objectId.
    await User.create({ name: '12CharString', role: 'admin' })
    const miss = await User.find({ name: '12CharString' }).lean().cache('30 seconds')
    const hit = await User.find({ name: '12CharString' }).lean().cache('30 seconds')
    expect(miss).not.toBeNull()
    expect(hit).not.toBeNull()
    expect(hit).toEqual(miss)
  })
})
