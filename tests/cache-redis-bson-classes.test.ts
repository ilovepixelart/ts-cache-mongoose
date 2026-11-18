import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'

import mongoose, { Schema } from 'mongoose'
import CacheMongoose from '../src/index'
import { server } from './mongo/server'

// A Redis hit holds BSON values of the same classes as the uncached result: the driver's, which
// are mongoose's own (mongoose.Types.ObjectId, mongoose.Types.Decimal128, ...). The uncached
// result is the oracle. Writes keys under its own prefix, so it runs only against a Redis named
// explicitly through REDIS_PORT.
const redisPort = process.env.REDIS_PORT

const T = Schema.Types
type Ctor = new (arg?: unknown) => object
const B = (mongoose.mongo as unknown as { BSON: Record<string, Ctor> & { Long: { fromString: (value: string) => unknown } } }).BSON
const hasBigInt = 'BigInt' in T
const hasUUID = 'UUID' in T

const definition: Record<string, unknown> = { name: String, ref: T.ObjectId, price: T.Decimal128, blob: Buffer, when: Date, meta: T.Mixed }
if (hasBigInt) definition.big = (T as unknown as Record<string, unknown>).BigInt
if (hasUUID) definition.uuid = (T as unknown as Record<string, unknown>).UUID
const BsonModel = mongoose.model('BsonClassesDoc', new Schema(definition))

// Every BSON type a lean result can carry, written through the driver so that no schema casts it.
// The driver returns a Long within 53 bits as a number; one beyond is not covered here, because
// the relaxed EJSON stored in Redis keeps every Long as a number.
const raw = () => ({
  name: 'x',
  ref: new mongoose.Types.ObjectId('6afd590d9f0df3099fe15504'),
  price: mongoose.Types.Decimal128.fromString('1.25'),
  blob: new B.Binary(Buffer.from('ab')),
  uuidBinary: new B.UUID(),
  when: new Date('2024-01-02T00:00:00Z'),
  longSmall: B.Long.fromString('5'),
  stamp: new B.Timestamp({ t: 1, i: 2 }),
  meta: { nestedId: new mongoose.Types.ObjectId('6afd590d9f0df3099fe15505'), nestedPrice: mongoose.Types.Decimal128.fromString('2.5') },
  ...(hasBigInt ? { big: B.Long.fromString('7') } : {}),
  ...(hasUUID ? { uuid: new B.UUID() } : {}),
})

// The class of a value, named with whether it is the driver's class of that name, so that a
// failure shows which values come back as classes of another copy of bson.
const kindOf = (value: unknown): string => {
  if (value === null || typeof value !== 'object') return typeof value
  const ctor = value.constructor as Ctor & { name: string }
  return `${ctor.name}${B[ctor.name] === ctor || ctor === Date ? '' : ' (not the driver class)'}`
}

const leafKinds = (value: unknown, path = ''): Record<string, string> => {
  if (value !== null && typeof value === 'object' && (Array.isArray(value) || Object.getPrototypeOf(value) === Object.prototype)) {
    return Object.assign({}, ...Object.entries(value).map(([key, item]) => leafKinds(item, path === '' ? key : `${path}.${key}`)))
  }
  return { [path]: kindOf(value) }
}

const documentKinds = (doc: mongoose.Document): Record<string, string> => Object.fromEntries(Object.keys(definition).map((path) => [path, kindOf(doc.get(path))]))

describe.skipIf(!redisPort)('BSON classes of Redis hits', () => {
  const instance = server('cache-redis-bson-classes')
  let cache: CacheMongoose

  beforeAll(async () => {
    cache = CacheMongoose.init(mongoose, { engine: 'redis', engineOptions: { host: process.env.REDIS_HOST ?? 'localhost', port: Number(redisPort), keyPrefix: 'bson-classes:' } })
    await instance.create()
  })

  afterAll(async () => {
    await cache.clear()
    await cache.close()
    await instance.destroy()
  })

  beforeEach(async () => {
    await cache.clear()
    await BsonModel.deleteMany({})
    await BsonModel.collection.insertOne(raw())
  })

  it('a lean find hit has the classes of the uncached result', async () => {
    const miss = await BsonModel.find({}).lean().cache('1 minute').exec()
    const hit = await BsonModel.find({}).lean().cache('1 minute').exec()
    expect(hit).not.toBe(miss)
    expect(leafKinds(hit)).toEqual(leafKinds(miss))
    expect(hit[0]?._id).toBeInstanceOf(mongoose.Types.ObjectId)
    expect(hit[0]?.price).toBeInstanceOf(mongoose.Types.Decimal128)
  })

  it('a lean findOne hit has the classes of the uncached result', async () => {
    const miss = await BsonModel.findOne({}).lean().cache('1 minute').exec()
    const hit = await BsonModel.findOne({}).lean().cache('1 minute').exec()
    expect(leafKinds(hit)).toEqual(leafKinds(miss))
  })

  it('an aggregate hit has the classes of the uncached result', async () => {
    const miss = await BsonModel.aggregate([{ $match: {} }])
      .cache('1 minute')
      .exec()
    const hit = await BsonModel.aggregate([{ $match: {} }])
      .cache('1 minute')
      .exec()
    expect(leafKinds(hit)).toEqual(leafKinds(miss))
  })

  it('a distinct hit has the classes of the uncached result', async () => {
    const miss = await BsonModel.distinct('ref').cache('1 minute').exec()
    const hit = await BsonModel.distinct('ref').cache('1 minute').exec()
    expect(leafKinds(hit)).toEqual(leafKinds(miss))
    expect(hit[0]).toBeInstanceOf(mongoose.Types.ObjectId)
  })

  it('a non-lean find hit has the classes of the uncached result', async () => {
    const miss = await BsonModel.find({}).cache('1 minute').exec()
    const hit = await BsonModel.find({}).cache('1 minute').exec()
    expect(hit).toHaveLength(1)
    expect(documentKinds(hit[0] as mongoose.Document)).toEqual(documentKinds(miss[0] as mongoose.Document))
    expect(leafKinds((hit[0] as mongoose.Document).get('meta'))).toEqual(leafKinds((miss[0] as mongoose.Document).get('meta')))
  })
})
