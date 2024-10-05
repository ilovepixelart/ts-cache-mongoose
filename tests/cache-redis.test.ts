import mongoose from 'mongoose'
import plugin from '../src/plugin'

import Story from './models/Story'
import User from './models/User'

describe('cache redis', () => {
  const uri = `${globalThis.__MONGO_URI__}${globalThis.__MONGO_DB_NAME__}`

  const cache = plugin.init(mongoose, {
    engine: 'redis',
    engineOptions: {
      host: 'localhost',
      port: 6379,
    },
    defaultTTL: '10 seconds',
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
      role: 'admin',
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
      role: 'admin',
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
      role: 'admin',
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
      role: 'admin',
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
      role: 'admin',
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
        role: 'admin',
      },
      {
        name: 'Bob',
        role: 'admin',
      },
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
      { name: 'Alice', role: 'user' },
    ])

    const cache1 = await User.aggregate([{ $match: { role: 'admin' } }, { $group: { _id: '$role', count: { $sum: 1 } } }])
      .cache('30 seconds')
      .exec()

    await User.create({ name: 'Mark', role: 'admin' })

    const cache2 = await User.aggregate([{ $match: { role: 'admin' } }, { $group: { _id: '$role', count: { $sum: 1 } } }])
      .cache('30 seconds')
      .exec()

    expect(cache1).not.toBeNull()
    expect(cache2).not.toBeNull()
    expect(cache1?.[0].count).toEqual(cache2?.[0].count)
  })

  it('should use cache on aggregate with custom-key', async () => {
    await User.create([
      { name: 'John', role: 'admin' },
      { name: 'Bob', role: 'admin' },
      { name: 'Alice', role: 'user' },
    ])

    const cache1 = await User.aggregate([{ $match: { role: 'admin' } }, { $group: { _id: '$role', count: { $sum: 1 } } }])
      .cache('30 seconds', 'aggregate-custom-key')
      .exec()

    await User.create({ name: 'Mark', role: 'admin' })

    const cache2 = await User.aggregate([{ $match: { role: 'admin' } }, { $group: { _id: '$role', count: { $sum: 1 } } }])
      .cache('30 seconds', 'aggregate-custom-key')
      .exec()

    // Don't use cache key
    const cache3 = await User.aggregate([{ $match: { role: 'admin' } }, { $group: { _id: '$role', count: { $sum: 1 } } }]).exec()

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
      { name: 'Alice', role: 'user' },
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
      { name: 'Andy', role: 'user' },
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
      { name: 'G', role: 'user' },
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

    const miss = await User.distinct('_id').cache('30 seconds').exec()
    expect(miss).not.toBeNull()
    expect(miss?.length).toBe(3)
    expect(typeof miss?.[0]).toBe('object')
    expect(miss?.[0] instanceof mongoose.Types.ObjectId).toBeTruthy()

    const hit = await User.distinct('_id').cache('30 seconds').exec()
    expect(hit).not.toBeNull()
    expect(hit?.length).toBe(3)
    expect(typeof hit?.[0]).toBe('object')
    expect(hit?.[0] instanceof mongoose.Types.ObjectId).toBeTruthy()

    const cache4 = await User.distinct('role').cache('30 seconds').exec()
    expect(cache4).not.toBeNull()
    expect(cache4?.length).toBe(2)
    expect(cache4).toEqual(['admin', 'user'])

    const cache5 = await User.distinct('role').cache('30 seconds').exec()
    expect(cache5).not.toBeNull()
    expect(cache5?.length).toBe(2)
    expect(cache5).toEqual(['admin', 'user'])

    const cache6 = await User.distinct('createdAt').cache('30 seconds').exec()
    expect(cache6).not.toBeNull()
    expect(cache6?.length).toBe(3)
    expect(typeof cache6?.[0]).toBe('object')
    expect(cache6?.[0] instanceof Date).toBeTruthy()

    const cache7 = await User.distinct('createdAt').cache('30 seconds').exec()

    expect(miss).toEqual(hit)
    expect(cache4).toEqual(cache5)
    expect(cache6).toEqual(cache7)
  })

  it('should test exceptions', async () => {
    const user = await User.create({ name: 'i', role: 'admin' })
    const story1 = await Story.create({ title: '1', userId: user._id })
    const story2 = await Story.create({ title: '2', userId: user._id })

    const miss = await User.findOne({ name: 'i' }).populate({ path: 'stories' }).lean().cache('30 seconds').exec()
    const hit = await User.findOne({ name: 'i' }).populate({ path: 'stories' }).lean().cache('30 seconds').exec()

    expect(miss).not.toBeNull()
    expect(miss?._id instanceof mongoose.Types.ObjectId).toBeTruthy()
    expect(miss?.name).toBe('i')
    expect(miss?.stories).not.toBeNull()
    expect(miss?.stories?.length).toBe(2)

    expect(miss?.stories?.[0]._id).toEqual(story1._id)
    expect(miss?.stories?.[0]._id instanceof mongoose.Types.ObjectId).toBeTruthy()
    expect(typeof miss?.stories?.[0]._id).toBe('object')
    expect(miss?.stories?.[0].createdAt instanceof Date).toBeTruthy()
    expect(typeof miss?.stories?.[0].createdAt).toBe('object')

    expect(miss?.stories?.[1]._id).toEqual(story2._id)
    expect(miss?.stories?.[1]._id instanceof mongoose.Types.ObjectId).toBeTruthy()
    expect(typeof miss?.stories?.[1]._id).toBe('object')
    expect(miss?.stories?.[1].createdAt instanceof Date).toBeTruthy()
    expect(typeof miss?.stories?.[1].createdAt).toBe('object')

    expect(hit).not.toBeNull()
    expect(hit?._id instanceof mongoose.Types.ObjectId).toBeTruthy()
    expect(hit?.name).toBe('i')
    expect(hit?.stories).not.toBeNull()
    expect(hit?.stories?.length).toBe(2)

    expect(hit?.stories?.[0]._id).toEqual(story1._id)
    expect(hit?.stories?.[0]._id instanceof mongoose.Types.ObjectId).toBeTruthy()
    expect(typeof hit?.stories?.[0]._id).toBe('object')
    expect(hit?.stories?.[0].createdAt instanceof Date).toBeTruthy()
    expect(typeof hit?.stories?.[0].createdAt).toBe('object')

    expect(hit?.stories?.[1]._id).toEqual(story2._id)
    expect(hit?.stories?.[1]._id instanceof mongoose.Types.ObjectId).toBeTruthy()
    expect(typeof hit?.stories?.[1]._id).toBe('object')
    expect(hit?.stories?.[1].createdAt instanceof Date).toBeTruthy()
    expect(typeof hit?.stories?.[1].createdAt).toBe('object')

    expect(miss).toEqual(hit)
  })

  it('should not misclassify certain fields as objectIds', async () => {
    // ObjectId.isValid will return true for multiple scenarios.
    // A string being a potentially valid objectId should not be the
    // determining factor on wether or not deserialize it as objectId.
    const user = await User.create({
      name: '12CharString',
      role: '660ef695677786928202dc1f',
    })
    const pureLean = await User.findOne({ _id: user._id }).lean()

    const miss = await User.findOne({ _id: user._id }).lean().cache('30 seconds')
    const hit = await User.findOne({ _id: user._id }).lean().cache('30 seconds')

    expect(pureLean).not.toBeNull()
    expect(typeof pureLean?._id).toBe('object')
    expect(typeof pureLean?.createdAt).toBe('object')

    expect(miss).not.toBeNull()
    expect(typeof miss?._id).toBe('object')
    expect(typeof miss?.createdAt).toBe('object')

    expect(hit).not.toBeNull()
    expect(typeof hit?._id).toBe('object')
    expect(typeof hit?.createdAt).toBe('object')

    expect(miss?._id).toEqual(hit?._id)
    expect(miss?.role).toEqual(hit?.role)
    expect(miss?.createdAt).toEqual(hit?.createdAt)

    const distinctMiss = await User.distinct('_id').cache('30 seconds').lean().exec()
    expect(distinctMiss).not.toBeNull()
    expect(distinctMiss?.length).toBe(1)
    expect(distinctMiss).toEqual([pureLean?._id])

    const distinctHit = await User.distinct('_id').cache('30 seconds').lean().exec()
    expect(distinctHit).not.toBeNull()
    expect(distinctHit?.length).toBe(1)
    expect(distinctHit).toEqual([pureLean?._id])

    const distinctCreatedAtMiss = await User.distinct('createdAt').cache('30 seconds').lean().exec()
    expect(distinctCreatedAtMiss).not.toBeNull()
    expect(distinctCreatedAtMiss?.length).toBe(1)
    expect(typeof distinctCreatedAtMiss?.[0]).toBe('object')
    expect(distinctCreatedAtMiss?.[0] instanceof Date).toBeTruthy()
    expect(distinctCreatedAtMiss).toEqual([pureLean?.createdAt])

    const distinctCreatedAtHit = await User.distinct('createdAt').cache('30 seconds').lean().exec()
    expect(distinctCreatedAtHit).not.toBeNull()
    expect(distinctCreatedAtHit?.length).toBe(1)
    expect(typeof distinctCreatedAtMiss?.[0]).toBe('object')
    expect(distinctCreatedAtMiss?.[0] instanceof Date).toBeTruthy()
    expect(distinctCreatedAtHit).toEqual([pureLean?.createdAt])

    expect(miss).toEqual(hit)
  })

  it('should hydrate populated objects from cache', async () => {
    const user = await User.create({ name: 'Alex', role: 'user' })
    const story1 = await Story.create({ title: 'Ticket 1', userId: user._id })
    const story2 = await Story.create({ title: 'Ticket 2', userId: user._id })

    const populatedOriginal = await User.findOne({ name: 'Alex' }).populate('stories').lean().cache('1 minute').exec()

    expect(populatedOriginal).not.toBeNull()
    expect(populatedOriginal?._id instanceof mongoose.Types.ObjectId).toBeTruthy()
    expect(populatedOriginal?.name).toBe('Alex')
    expect(populatedOriginal?.stories).not.toBeNull()
    expect(populatedOriginal?.stories?.length).toBe(2)

    expect(populatedOriginal?.stories?.[0]._id).toEqual(story1._id)
    expect(populatedOriginal?.stories?.[0]._id instanceof mongoose.Types.ObjectId).toBeTruthy()
    expect(typeof populatedOriginal?.stories?.[0]._id).toBe('object')
    expect(populatedOriginal?.stories?.[0].createdAt instanceof Date).toBeTruthy()
    expect(typeof populatedOriginal?.stories?.[0].createdAt).toBe('object')

    expect(populatedOriginal?.stories?.[1]._id).toEqual(story2._id)
    expect(populatedOriginal?.stories?.[1]._id instanceof mongoose.Types.ObjectId).toBeTruthy()
    expect(typeof populatedOriginal?.stories?.[1]._id).toBe('object')
    expect(populatedOriginal?.stories?.[1].createdAt instanceof Date).toBeTruthy()
    expect(typeof populatedOriginal?.stories?.[1].createdAt).toBe('object')

    // Deleting user and stories, to ensure that the cache is used
    await User.deleteOne({ _id: user._id }).exec()
    await Story.deleteMany({ userId: user._id }).exec()

    const populatedCache = await User.findOne({ name: 'Alex' }).populate('stories').lean().cache('1 minute').exec()

    expect(populatedCache).not.toBeNull()
    expect(populatedCache?._id instanceof mongoose.Types.ObjectId).toBeTruthy()
    expect(populatedCache?.name).toBe('Alex')
    expect(populatedCache?.stories).not.toBeNull()
    expect(populatedCache?.stories?.length).toBe(2)

    expect(populatedCache?.stories?.[0]._id).toEqual(story1._id)
    expect(populatedCache?.stories?.[0]._id instanceof mongoose.Types.ObjectId).toBeTruthy()
    expect(typeof populatedCache?.stories?.[0]._id).toBe('object')
    expect(populatedCache?.stories?.[0].createdAt instanceof Date).toBeTruthy()
    expect(typeof populatedCache?.stories?.[0].createdAt).toBe('object')

    expect(populatedCache?.stories?.[1]._id).toEqual(story2._id)
    expect(populatedCache?.stories?.[1]._id instanceof mongoose.Types.ObjectId).toBeTruthy()
    expect(typeof populatedCache?.stories?.[1]._id).toBe('object')
    expect(populatedCache?.stories?.[1].createdAt instanceof Date).toBeTruthy()
    expect(typeof populatedCache?.stories?.[1].createdAt).toBe('object')

    expect(populatedOriginal).toEqual(populatedCache)

    // Code bellow will fail see: https://github.com/Automattic/mongoose/issues/14503

    // const populatedJson = JSON.stringify(populatedOriginal)
    // expect(populatedJson).not.toBeNull()

    // const hydrated = User.hydrate(JSON.parse(populatedJson), undefined, { hydratedPopulatedDocs: true })

    // expect(hydrated).not.toBeNull()
    // expect(hydrated?._id instanceof mongoose.Types.ObjectId).toBeTruthy()
    // expect(hydrated?.name).toBe('Alex')
    // expect(hydrated?.stories).not.toBeNull()
    // expect(hydrated?.stories?.length).toBe(2)

    // expect(hydrated?.stories?.[0]._id).toEqual(story1._id)
    // expect(typeof hydrated?.stories?.[0]._id).toBe('object')
    // expect(hydrated?.stories?.[0]._id instanceof mongoose.Types.ObjectId).toBeTruthy()
    // expect(typeof hydrated?.stories?.[0].createdAt).toBe('object')
    // expect(hydrated?.stories?.[0].createdAt instanceof Date).toBeTruthy()

    // expect(hydrated?.stories?.[1]._id).toEqual(story2._id)
    // expect(typeof hydrated?.stories?.[1]._id).toBe('object')
    // expect(hydrated?.stories?.[1]._id instanceof mongoose.Types.ObjectId).toBeTruthy()
    // expect(typeof hydrated?.stories?.[1].createdAt).toBe('object')
    // expect(hydrated?.stories?.[1].createdAt instanceof Date).toBeTruthy()
  })
})
