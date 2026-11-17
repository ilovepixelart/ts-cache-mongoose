import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'

import mongoose, { Schema } from 'mongoose'
import CacheMongoose from '../src/index'
import { server } from './mongo/server'

// What a memory cache hit returns, pinned against the uncached result of the same query: equal
// values and the same constructor at every node of the tree.

const shapeOf = (value: unknown): unknown => {
  if (value === null || typeof value !== 'object') return typeof value
  const name = (value.constructor as { name?: string } | undefined)?.name ?? 'null-prototype'
  if (Array.isArray(value)) return { [name]: value.map(shapeOf) }
  if (value instanceof Map) return { [name]: [...value].map(([k, v]) => [k, shapeOf(v)]) }
  if (name !== 'Object' && name !== 'null-prototype') return name
  return { [name]: Object.fromEntries(Object.entries(value).map(([k, v]) => [k, shapeOf(v)])) }
}

const expectSameValue = (hit: unknown, miss: unknown) => {
  expect(hit).toEqual(miss)
  expect(shapeOf(hit)).toEqual(shapeOf(miss))
}

const optional: Record<string, unknown> = {}
if ('UUID' in Schema.Types) optional.uuid = Schema.Types.UUID
if ('BigInt' in Schema.Types) optional.big = Schema.Types.BigInt

const ValueRef = mongoose.model('ValueRef', new Schema({ title: String }))
const ValueSchema = new Schema({
  name: String,
  oid: Schema.Types.ObjectId,
  when: Date,
  dec: Schema.Types.Decimal128,
  buf: Buffer,
  map: { type: Map, of: Number },
  tags: [String],
  matrix: [[Number]],
  subs: [{ x: Number }],
  nested: { y: String, z: Date },
  single: new Schema({ q: String }),
  mixed: Schema.Types.Mixed,
  ref: { type: Schema.Types.ObjectId, ref: 'ValueRef' },
  refs: [{ type: Schema.Types.ObjectId, ref: 'ValueRef' }],
  ...optional,
})
const ValueModel = mongoose.model('Value', ValueSchema)

const ShapedSchema = new Schema(
  {
    secret: String,
    upper: { type: String, get: (v: string) => v?.toUpperCase() },
    mixed: Schema.Types.Mixed,
    ref: { type: Schema.Types.ObjectId, ref: 'ValueRef' },
  },
  {
    toObject: {
      getters: true,
      virtuals: true,
      versionKey: false,
      depopulate: true,
      transform: (_doc: unknown, ret: Record<string, unknown>) => {
        delete ret.secret
        return ret
      },
    },
  },
)
ShapedSchema.virtual('shout').get(function (this: { get: (path: string) => unknown }) {
  return `${String(this.get('upper'))}!`
})
const ShapedModel = mongoose.model('Shaped', ShapedSchema)

describe('memory cache hit values', () => {
  const instance = server('cache-memory-values')
  let cache: CacheMongoose
  let ops = 0
  const errors: Error[] = []

  beforeAll(async () => {
    // A size calculation that never fails, so every result shape is stored on every
    // supported mongoose version and the second call below is a real cache hit.
    cache = CacheMongoose.init(mongoose, { engine: 'memory', sizeCalculation: () => 1, onError: (e) => errors.push(e) })
    await instance.create()
    mongoose.set('debug', () => {
      ops++
    })
  })

  afterAll(async () => {
    mongoose.set('debug', false)
    await cache.clear()
    await cache.close()
    await instance.destroy()
  })

  beforeEach(async () => {
    await ValueModel.deleteMany({})
    await ValueRef.deleteMany({})
    await ShapedModel.deleteMany({})
    await cache.clear()
    const ref = await ValueRef.create({ title: 'referenced' })
    await ValueModel.create({
      name: 'first',
      oid: new mongoose.Types.ObjectId(),
      when: new Date('2026-01-02T03:04:05.006Z'),
      dec: '1.5',
      buf: Buffer.from('bytes'),
      map: { a: 1, b: 2 },
      tags: ['a', 'b'],
      matrix: [
        [1, 2],
        [3, 4],
      ],
      subs: [{ x: 1 }, { x: 2 }],
      nested: { y: 'n', z: new Date('2026-02-03T04:05:06.007Z') },
      single: { q: 's' },
      mixed: { deep: [new Date('2026-03-04T05:06:07.008Z'), { k: 1 }], empty: {} },
      ref: ref._id,
      refs: [ref._id],
      ...(optional.uuid ? { uuid: '09190f70-3d30-11e5-8814-0f4df9a59c41' } : {}),
      ...(optional.big ? { big: 5n } : {}),
    })
    // Inserted past mongoose so the empty object survives the schema's default minimize.
    await ShapedModel.collection.insertOne({ secret: 's3', upper: 'abc', mixed: { empty: {} }, ref: ref._id, __v: 0 })
    ops = 0
    errors.length = 0
  })

  const twice = async <T>(run: () => Promise<T>): Promise<[T, T]> => {
    const miss = await run()
    const missOps = ops
    const hit = await run()
    expect(missOps).toBeGreaterThan(0)
    expect(ops).toBe(missOps)
    expect(errors).toEqual([])
    return [miss, hit]
  }

  describe('lean, aggregate, distinct and count', () => {
    it('lean find hit equals the miss', async () => {
      const [miss, hit] = await twice(() => ValueModel.find().lean().cache())
      expectSameValue(hit, miss)
    })

    it('lean findOne hit equals the miss', async () => {
      const [miss, hit] = await twice(() => ValueModel.findOne().lean().cache())
      expectSameValue(hit, miss)
    })

    it('lean populate hit equals the miss', async () => {
      const [miss, hit] = await twice(() => ValueModel.findOne().populate('ref refs').lean().cache())
      expectSameValue(hit, miss)
    })

    it('aggregate hit equals the miss', async () => {
      const [miss, hit] = await twice(() => ValueModel.aggregate([{ $match: {} }]).cache())
      expectSameValue(hit, miss)
    })

    it('distinct hit equals the miss', async () => {
      const [miss, hit] = await twice(() => ValueModel.distinct('subs._id').cache())
      expectSameValue(hit, miss)
    })

    it('countDocuments hit equals the miss', async () => {
      const [miss, hit] = await twice(() => ValueModel.countDocuments().cache())
      expect(miss).toBe(1)
      expect(hit).toBe(1)
    })
  })

  describe('non-lean', () => {
    it('findOne hit is a hydrated document equal to the miss', async () => {
      const [miss, hit] = await twice(() => ValueModel.findOne().cache())
      expect(hit).toBeInstanceOf(ValueModel)
      expect(hit?.isNew).toBe(false)
      expect(hit?.isModified()).toBe(false)
      expectSameValue(hit?.toObject(), miss?.toObject())
      expect(hit?.map).toBeInstanceOf(Map)
      expect(hit?.map?.get('b')).toBe(2)
    })

    it('find hit is an array of hydrated documents equal to the miss', async () => {
      const [miss, hit] = await twice(() => ValueModel.find().cache())
      expect(hit).toHaveLength(1)
      expect(hit[0]).toBeInstanceOf(ValueModel)
      expectSameValue(
        hit.map((d) => d.toObject()),
        miss.map((d) => d.toObject()),
      )
    })

    it('populated paths stay populated documents on a hit', async () => {
      const [miss, hit] = await twice(() => ValueModel.findOne().populate('ref refs').cache())
      expect(hit?.ref).toBeInstanceOf(ValueRef)
      expect((hit?.ref as unknown as { title: string } | undefined)?.title).toBe('referenced')
      expect(hit?.refs[0]).toBeInstanceOf(ValueRef)
      expectSameValue(hit?.toObject(), miss?.toObject())
    })

    it('schema toObject options and getters do not change the stored data', async () => {
      const raw = { transform: false, getters: false, virtuals: false, depopulate: false, versionKey: true, minimize: false }
      const [miss, hit] = await twice(() => ShapedModel.findOne().populate('ref').cache())
      expect(hit?.get('secret')).toBe('s3')
      expect(hit?.get('upper', null, { getters: false })).toBe('abc')
      expect(hit?.upper).toBe('ABC')
      expect(hit?.get('shout')).toBe('ABC!')
      expect(hit?.get('mixed')).toEqual({ empty: {} })
      expect(hit?.get('__v')).toBe(0)
      expect(hit?.ref).toBeInstanceOf(ValueRef)
      expectSameValue(hit?.toObject(raw), miss?.toObject(raw))
      expectSameValue(hit?.toObject(), miss?.toObject())
    })
  })
})
