import mongoose, { model } from 'mongoose'
import CacheMongoose from '../src/plugin'

import UserSchema from './schemas/UserSchema'

describe('cache redis', () => {
  const uri = `${globalThis.__MONGO_URI__}${globalThis.__MONGO_DB_NAME__}`
  const User = model('User', UserSchema)

  const cache = CacheMongoose.init(mongoose, {
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
  })

  it('should use cache', async () => {
    const user = await User.create({
      name: 'John Doe',
      role: 'admin'
    })

    const user1 = await User.findById(user._id).cache()
    await User.findOneAndUpdate({ _id: user._id }, { name: 'John Doe 2' })
    const user2 = await User.findById(user._id).cache()

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
    await User.findOneAndUpdate({ _id: user._id }, { name: 'John Doe 2' })
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
    await User.updateOne({ _id: user._id }, { name: 'Steve' })
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

    const cache1 = await User.findById(user._id).cache()
    await User.updateOne({ _id: user._id }, { name: 'John Doe 2' })
    const cache2 = await User.findById(user._id).cache()

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

    const cache3 = await User.find({ role: 'admin' }).cache()
    await User.updateMany({ role: 'admin' }, { name: 'Steve' })
    const cache4 = await User.find({ role: 'admin' }).cache()

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
    ]).cache('30 seconds')

    await User.create({ name: 'Mark', role: 'admin' })

    const cache2 = await User.aggregate([
      { $match: { role: 'admin' } },
      { $group: { _id: '$role', count: { $sum: 1 } } }
    ]).cache('30 seconds')

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
    ]).cache('30 seconds', 'aggregate-custom-key')

    await User.create({ name: 'Mark', role: 'admin' })

    const cache2 = await User.aggregate([
      { $match: { role: 'admin' } },
      { $group: { _id: '$role', count: { $sum: 1 } } }
    ]).cache('30 seconds', 'aggregate-custom-key')

    // Don't use cache key
    const cache3 = await User.aggregate([
      { $match: { role: 'admin' } },
      { $group: { _id: '$role', count: { $sum: 1 } } }
    ])

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

    const cache1 = await User.find({ role: 'admin' }).lean().cache('30 seconds')
    await User.create({ name: 'Mark', role: 'admin' })
    const cache2 = await User.find({ role: 'admin' }).lean().cache('30 seconds')

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

    const cache1 = await User.find({ name: /^J/ }).cache('30 seconds')
    await User.create({ name: 'Jenifer', role: 'admin' })
    const cache2 = await User.find({ name: /^J/ }).cache('30 seconds')

    expect(cache1).not.toBeNull()
    expect(cache2).not.toBeNull()
    expect(cache1?.length).toEqual(cache2?.length)

    const cache3 = await User.find({ name: /^A/ }).cache('30 seconds')
    await User.create({ name: 'Alex', role: 'admin' })
    const cache4 = await User.find({ name: /^A/ }).cache('30 seconds')

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
    await User.create({ name: 'Jenifer', role: 'admin' })
    const cache2 = await User.findOne({ name: 'G' }).lean().cache('30 seconds').exec()
    const cache3 = await User.findOne({ name: 'G' }).lean().cache('30 seconds').exec()

    const cache4 = await User.findOne({ name: 'V' }).lean().cache('30 seconds').exec()

    expect(cache1).not.toBeNull()
    expect(cache2).not.toBeNull()
    expect(cache3).not.toBeNull()
    expect(cache4).not.toBeNull()
    expect(cache4).toHaveProperty('name', 'V')

    expect(cache2).toEqual(cache3)
    expect(cache1).toEqual(cache2)
  })
})
