import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'

import mongoose, { Schema } from 'mongoose'
import CacheMongoose from '../../src/index'
import { server } from '../mongo/server'
import { loose } from './loose'
import { canonical, canonicalWithoutIds } from './observe'

import type { CacheOptions } from '../../src/types'

// Shape matrix: for every document shape, projection, populate, lean flag and operation, N
// identical cached calls cost exactly the MongoDB round trips of one uncached call, every
// result (miss and hits) is observably equal to the uncached result, and onError is never
// called. The uncached result is the oracle.

const T = Schema.Types
type Projection = string | Record<string, unknown> | null
type Populate = string | Record<string, unknown> | null

const CALLS = 3
const READ_METHODS = new Set(['find', 'findOne', 'aggregate', 'countDocuments', 'distinct'])

// A Mixed value with own "__proto__" and "constructor" keys, as JSON.parse produces it.
export const PROTO_PAYLOAD = '{"__proto__":{"isAdmin":true},"constructor":{"prototype":{"x":1}}}'

const Country = mongoose.model('ShapeCountry', new Schema({ code: String }))
const Author = mongoose.model('ShapeAuthor', new Schema({ name: String, born: Date, tag: { type: String, default: 'x' }, country: { type: T.ObjectId, ref: 'ShapeCountry' } }))

const flatSchema = new Schema({
  name: String,
  age: Number,
  role: { type: String, default: 'user' },
  secret: { type: String, select: false, default: 's' },
  upper: { type: String, get: (value?: string) => value?.toUpperCase() },
})
flatSchema.virtual('label').get(function (this: { name?: string; role?: string }) {
  return `${this.name}:${this.role}`
})

const typesDefinition: Record<string, unknown> = {
  name: String,
  price: T.Decimal128,
  blob: Buffer,
  attrs: { type: Map, of: String },
  subs: { type: Map, of: new Schema({ k: String, d: { type: String, default: 'd' } }) },
  when: Date,
  oid: T.ObjectId,
  meta: T.Mixed,
}
const hasBigInt = 'BigInt' in T
const hasUUID = 'UUID' in T
if (hasBigInt) typesDefinition.big = (T as unknown as Record<string, unknown>).BigInt
if (hasUUID) typesDefinition.uuid = (T as unknown as Record<string, unknown>).UUID

const Base = mongoose.model('ShapeBase', new Schema({ name: String, role: { type: String, default: 'user' } }))
const Child = Base.discriminator('ShapeChild', new Schema({ extra: { type: String, default: 'e' }, hidden: { type: String, select: false, default: 'h' } }))

const models = {
  flat: loose(mongoose.model('ShapeFlat', flatSchema)),
  strings: loose(mongoose.model('ShapeStrings', new Schema({ name: String, tags: [String] }))),
  subdocs: loose(mongoose.model('ShapeSubdocs', new Schema({ name: String, comments: [{ text: String, at: Date, votes: { type: Number, default: 0 } }] }))),
  single: loose(mongoose.model('ShapeSingle', new Schema({ name: String, addr: new Schema({ city: String, zip: { type: String, default: '0' } }) }))),
  nested: loose(mongoose.model('ShapeNested', new Schema({ name: String, nested: { a: Number, b: { type: String, default: 'nb' } } }))),
  types: loose(mongoose.model('ShapeTypes', new Schema(typesDefinition))),
  discriminator: loose(Base),
  populate: loose(
    mongoose.model(
      'ShapeRef',
      new Schema({
        name: String,
        author: { type: T.ObjectId, ref: 'ShapeAuthor' },
        authors: [{ type: T.ObjectId, ref: 'ShapeAuthor' }],
        comments: [{ text: String, by: { type: T.ObjectId, ref: 'ShapeAuthor' } }],
      }),
    ),
  ),
}

type ShapeName = keyof typeof models

const projections: Record<ShapeName, Projection[]> = {
  flat: [null, 'name age', '-age', { name: 1, _id: 0 }, '+secret', '-role -upper'],
  strings: [null, 'name tags', '-tags', { name: 1, _id: 0 }, { tags: { $slice: 1 } }],
  subdocs: [null, 'name comments', '-comments', { name: 1, _id: 0 }, 'comments.text', '-comments.votes'],
  single: [null, 'name addr', '-addr', { name: 1, _id: 0 }, 'addr.city', '-addr.zip'],
  nested: [null, 'name nested', '-nested', { name: 1, _id: 0 }, 'nested.a', '-nested.b'],
  types: [null, 'name price blob attrs when', '-meta -subs', { name: 1, _id: 0 }, 'subs meta'],
  discriminator: [null, 'name extra', '-role', { name: 1, _id: 0 }, '+hidden'],
  populate: [null, 'name author authors comments', '-comments', { name: 1, _id: 0 }],
}

const populates: Populate[] = [null, 'author', 'authors', 'author authors', 'comments.by', { path: 'author', select: 'name' }, { path: 'author', select: '-born' }, { path: 'author', populate: 'country' }]

const seed = async (): Promise<void> => {
  const country = await Country.create({ code: 'CH' })
  const ada = await Author.create({ name: 'ada', born: new Date('1815-12-10T00:00:00Z'), country: country._id })
  const bob = await Author.create({ name: 'bob' })
  await models.flat.create({ name: 'a', age: 36, role: 'admin', secret: 'p', upper: 'low' })
  await models.strings.create({ name: 'a', tags: ['x', 'y'] })
  await models.subdocs.create({ name: 'a', comments: [{ text: 'c1', at: new Date('2024-01-03T00:00:00Z'), votes: 2 }, { text: 'c2' }] })
  await models.single.create({ name: 'a', addr: { city: 'Zurich' } })
  await models.nested.create({ name: 'a', nested: { a: 1 } })
  const types: Record<string, unknown> = {
    name: 'a',
    price: '12.34',
    blob: Buffer.from([1, 2, 3]),
    attrs: { k: 'v' },
    subs: { x: { k: 'y' } },
    when: new Date('2024-01-02T00:00:00Z'),
    oid: new mongoose.Types.ObjectId(),
    meta: { deep: { list: [1, { y: 2 }] }, empty: {} },
  }
  if (hasBigInt) types.big = 42n
  if (hasUUID) types.uuid = '09190f70-3d30-11e5-8814-0f4df9a59c41'
  await models.types.create(types)
  await Base.create({ name: 'a' })
  await Child.create({ name: 'c', extra: 'given' })
  await models.populate.create({
    name: 'a',
    author: ada._id,
    authors: [ada._id, bob._id],
    comments: [
      { text: 'c', by: bob._id },
      { text: 'd', by: ada._id },
    ],
  })

  // Documents as another writer left them: no defaults applied, no arrays, no subdocuments.
  for (const model of Object.values(models)) {
    await model.collection.insertOne({ name: 'b' })
  }
  await models.types.collection.updateOne({ name: 'b' }, { $set: { meta: JSON.parse(PROTO_PAYLOAD) } })
  await Base.collection.insertOne({ name: 'd', __t: 'ShapeChild' })
}

type Case = { shape: ShapeName; op: 'find' | 'findOne'; filter: Record<string, unknown>; projection: Projection; populate: Populate; lean: boolean }

const casesOf = (shape: ShapeName): Case[] => {
  const out: Case[] = []
  const shapePopulates = shape === 'populate' ? populates : [null]
  for (const projection of projections[shape]) {
    for (const populate of shapePopulates) {
      for (const lean of [false, true]) {
        out.push({ shape, op: 'find', filter: {}, projection, populate, lean })
        for (const name of ['a', 'b']) out.push({ shape, op: 'findOne', filter: { name }, projection, populate, lean })
      }
    }
  }
  return out
}

const label = (c: Case): string => `${c.op}(${JSON.stringify(c.filter)}) select=${JSON.stringify(c.projection)} populate=${JSON.stringify(c.populate)} lean=${c.lean}`

const build = (c: Case) => {
  const model = models[c.shape]
  let query = c.op === 'find' ? model.find(c.filter).sort({ name: 1 }) : model.findOne(c.filter)
  if (c.projection != null) query = query.select(c.projection)
  if (c.populate != null) query = query.populate(c.populate)
  if (c.lean) query = query.lean()
  return query
}

const hasGeneratedId = (result: unknown): boolean => (Array.isArray(result) ? result : [result]).some((doc: unknown) => doc instanceof mongoose.Document && (doc as { $isDefault: (path: string) => boolean }).$isDefault('_id'))

const protoChecks = (truth: unknown, hit: unknown): void => {
  if (Array.isArray(truth) && Array.isArray(hit)) {
    for (const [i, item] of truth.entries()) protoChecks(item, hit[i])
    return
  }
  const metaOf = (value: unknown): unknown => {
    const record = value as { get?: (path: string) => unknown; meta?: unknown } | null
    if (record == null) return undefined
    return typeof record.get === 'function' ? record.get('meta') : record.meta
  }
  const truthMeta = metaOf(truth) as Record<string, unknown> | undefined
  const hitMeta = metaOf(hit) as Record<string, unknown> | undefined
  if (truthMeta == null) {
    expect(hitMeta).toBeUndefined()
    return
  }
  if (hitMeta == null) throw new Error('expected meta on the hit')
  expect(Object.getPrototypeOf(hitMeta)).toBe(Object.getPrototypeOf(truthMeta))
  expect(Object.hasOwn(hitMeta, '__proto__')).toBe(Object.hasOwn(truthMeta, '__proto__'))
  expect(hitMeta.isAdmin).toBeUndefined()
  expect(({} as Record<string, unknown>).isAdmin).toBeUndefined()
  expect(({} as Record<string, unknown>).x).toBeUndefined()
}

export const describeShapeMatrix = (engine: string, options: () => CacheOptions | undefined): void => {
  describe.skipIf(options() === undefined)(`non-lean and lean cache hits equal the uncached result (${engine})`, () => {
    const instance = server(`cache-shapes-${engine}`)
    const onError = vi.fn()
    let reads = 0
    let cache: CacheMongoose

    beforeAll(async () => {
      cache = CacheMongoose.init(mongoose, { ...(options() as CacheOptions), onError })
      await instance.create()
      await cache.clear()
      await seed()
      mongoose.set('debug', (_collection: string, method: string) => {
        if (READ_METHODS.has(method)) reads++
      })
    })

    afterAll(async () => {
      mongoose.set('debug', false)
      await cache.clear()
      await cache.close()
      await instance.destroy()
    })

    for (const shape of Object.keys(models) as ShapeName[]) {
      describe(shape, () => {
        it.each(casesOf(shape).map((c) => [label(c), c] as const))('%s', async (_name, c) => {
          reads = 0
          const truth: unknown = await build(c).exec()
          const uncachedReads = reads
          // mongoose 8 gives discriminator documents loaded with `_id: 0` a new random _id on
          // every load; where two uncached results differ, ids are left out of the comparison.
          const repeatable = canonical(await build(c).exec()) === canonical(truth)
          const view = repeatable ? canonical : canonicalWithoutIds

          reads = 0
          const results: unknown[] = []
          for (let i = 0; i < CALLS; i++) results.push(await build(c).cache().exec())

          // A document whose _id mongoose generated on load is served from MongoDB every time.
          expect(reads).toBe(hasGeneratedId(truth) ? CALLS * uncachedReads : uncachedReads)
          for (const result of results) {
            // Structure first for a readable diff, then the exact text, which also pins key order.
            expect(JSON.parse(view(result))).toEqual(JSON.parse(view(truth)))
            expect(view(result)).toBe(view(truth))
          }
          if (shape === 'types') for (const result of results) protoChecks(truth, result)
          expect(onError).not.toHaveBeenCalled()
        })
      })
    }
  })
}
