import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

import mongoose, { Schema } from 'mongoose'
import CacheMongoose from '../../src/index'
import { server } from '../mongo/server'

import type { CacheOptions } from '../../src/types'

// Concurrent identical cached queries on a cold key share one MongoDB round trip, and every
// caller still gets a result of its own.

const READ_METHODS = new Set(['find', 'findOne', 'aggregate', 'countDocuments', 'distinct'])
const CALLERS = 50

type Row = { name: string; n: number; tags: string[]; meta: { k: string }; owner?: { name: string } }

const Owner = mongoose.model('CoalesceOwner', new Schema({ name: String }))

const ItemSchema = new Schema({ name: String, n: Number, tags: [String], meta: Schema.Types.Mixed, owner: { type: Schema.Types.ObjectId, ref: 'CoalesceOwner' } })
const hooks = { failing: false, attempts: 0, failGate: undefined as Promise<void> | undefined, gate: undefined as Promise<void> | undefined }
// Holds the first find before MongoDB until the fail gate opens, then fails it when failing is set.
ItemSchema.pre('find', async () => {
  hooks.attempts++
  const gate = hooks.failGate
  hooks.failGate = undefined
  await gate
  if (hooks.failing) throw new Error('find refused')
})
// Holds the first find after its reply until the gate opens, so that it stays in flight.
ItemSchema.post('find', async () => {
  const gate = hooks.gate
  hooks.gate = undefined
  await gate
})
const Item = mongoose.model('CoalesceItem', ItemSchema)

// Documents a post('find') hook changes are not cached, so they cannot be shared either.
const HookedSchema = new Schema({ name: String })
HookedSchema.post('find', (docs: { name: string }[]) => {
  for (const doc of docs) doc.name = `${doc.name} hooked`
})
const Hooked = mongoose.model('CoalesceHooked', HookedSchema)

const plain = (value: unknown): unknown => JSON.parse(JSON.stringify(value))

const distinctObjects = (values: unknown[]): number => new Set(values).size

export const describeCoalescing = (engine: string, options: () => CacheOptions | undefined): void => {
  describe.skipIf(options() === undefined)(`concurrent identical queries share one MongoDB round trip (${engine})`, () => {
    const instance = server(`cache-coalesce-${engine}`)
    const onError = vi.fn()
    let reads = 0
    let cache: CacheMongoose

    beforeAll(async () => {
      cache = CacheMongoose.init(mongoose, { ...(options() as CacheOptions), onError })
      await instance.create()
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

    beforeEach(async () => {
      hooks.failing = false
      hooks.attempts = 0
      hooks.failGate = undefined
      hooks.gate = undefined
      onError.mockReset()
      await cache.clear()
      await Item.deleteMany({})
      await Owner.deleteMany({})
      await Hooked.deleteMany({})
      await Hooked.create({ name: 'h' })
      const [ann, bob] = await Owner.create([{ name: 'ann' }, { name: 'bob' }])
      await Item.create([
        { name: 'a', n: 1, tags: ['x'], meta: { k: 'a' }, owner: ann?._id },
        { name: 'b', n: 2, tags: ['y'], meta: { k: 'b' }, owner: bob?._id },
      ])
      reads = 0
    })

    const all = <T>(build: () => PromiseLike<T>): Promise<T[]> => Promise.all(Array.from({ length: CALLERS }, build))

    // [name, cached query, uncached query, MongoDB reads of one run]
    const queries: [string, () => PromiseLike<unknown>, () => PromiseLike<unknown>, number][] = [
      ['lean find', () => Item.find({}).sort({ n: 1 }).lean().cache(), () => Item.find({}).sort({ n: 1 }).lean(), 1],
      ['find', () => Item.find({}).sort({ n: 1 }).cache(), () => Item.find({}).sort({ n: 1 }), 1],
      ['findOne', () => Item.findOne({ name: 'a' }).cache(), () => Item.findOne({ name: 'a' }), 1],
      ['lean findOne', () => Item.findOne({ name: 'a' }).lean().cache(), () => Item.findOne({ name: 'a' }).lean(), 1],
      ['findOne without a match', () => Item.findOne({ name: 'none' }).cache(), () => Item.findOne({ name: 'none' }), 1],
      ['countDocuments', () => Item.countDocuments({}).cache(), () => Item.countDocuments({}), 1],
      ['distinct', () => Item.distinct('name').cache(), () => Item.distinct('name'), 1],
      ['aggregate', () => Item.aggregate([{ $sort: { n: 1 } }]).cache(), () => Item.aggregate([{ $sort: { n: 1 } }]), 1],
      ['populated find', () => Item.find({}).sort({ n: 1 }).populate('owner').cache(), () => Item.find({}).sort({ n: 1 }).populate('owner'), 2],
      ['populated lean find', () => Item.find({}).sort({ n: 1 }).populate('owner').lean().cache(), () => Item.find({}).sort({ n: 1 }).populate('owner').lean(), 2],
    ]

    it.each(queries)('runs one MongoDB round trip for concurrent callers of a %s', async (_name, cached, uncached, roundTrips) => {
      const expected = plain(await uncached())
      reads = 0
      const results = await all(cached)
      expect(reads).toBe(roundTrips)
      for (const result of results) expect(plain(result)).toEqual(expected)
      expect(onError).not.toHaveBeenCalled()
    })

    it.each(queries.filter(([name]) => !['countDocuments', 'findOne without a match'].includes(name)))('hands every concurrent caller of a %s its own object', async (_name, cached) => {
      const results = await all(cached)
      expect(distinctObjects(results)).toBe(CALLERS)
      const firsts = results.map((result) => (Array.isArray(result) ? result[0] : result))
      if (typeof firsts[0] === 'object') expect(distinctObjects(firsts)).toBe(CALLERS)
    })

    it('hands every concurrent non-lean caller documents of its own, populated ones included', async () => {
      const results = (await all(() => Item.find({}).sort({ n: 1 }).populate('owner').cache())) as unknown as (mongoose.Document & Row)[][]
      for (const docs of results) {
        expect(docs[0]).toBeInstanceOf(Item)
        expect(docs[0]?.owner).toBeInstanceOf(Owner)
      }
      expect(distinctObjects(results.map((docs) => docs[0]?.owner))).toBe(CALLERS)
      const [mine, ...others] = results
      const doc = mine?.[0] as mongoose.Document & Row
      doc.name = 'mutated'
      doc.tags.push('mutated')
      doc.meta.k = 'mutated'
      ;(doc.owner as { name: string }).name = 'mutated'
      for (const docs of others) {
        expect(docs[0]?.name).toBe('a')
        expect([...(docs[0]?.tags ?? [])]).toEqual(['x'])
        expect(docs[0]?.meta).toEqual({ k: 'a' })
        expect(docs[0]?.owner?.name).toBe('ann')
      }
    })

    it('keeps the result the first caller changes as soon as it has it out of the other callers', async () => {
      const results = await all(() =>
        Item.find({})
          .sort({ n: 1 })
          .lean()
          .cache()
          .then((rows) => {
            const row = rows[0] as unknown as Row
            const seen = plain(rows)
            row.name = 'mutated'
            row.tags.push('mutated')
            row.meta.k = 'mutated'
            return seen
          }),
      )
      for (const rows of results) expect(rows).toEqual([expect.objectContaining({ name: 'a', tags: ['x'], meta: { k: 'a' } }), expect.objectContaining({ name: 'b' })])
      expect(reads).toBe(1)
    })

    it('rejects every caller waiting on a shared query with its error, then runs the next call again', async () => {
      let open = () => {}
      hooks.failGate = new Promise<void>((resolve) => {
        open = resolve
      })
      hooks.failing = true
      const settled = Promise.allSettled(Array.from({ length: CALLERS }, () => Item.find({ n: 1 }).lean().cache().exec()))
      await vi.waitUntil(() => hooks.attempts > 0)
      // A cache read issued after the callers' reads: once it is answered, every caller has read
      // the cache and is waiting on the shared query.
      await Owner.find({ name: 'probe' }).lean().cache()
      open()
      const outcomes = await settled
      const reasons = outcomes.map((outcome) => (outcome as PromiseRejectedResult).reason as Error)
      expect(outcomes.every((outcome) => outcome.status === 'rejected')).toBe(true)
      expect(distinctObjects(reasons)).toBe(1)
      expect(reasons[0]?.message).toBe('find refused')
      expect(hooks.attempts).toBe(1)
      expect(onError).not.toHaveBeenCalled()

      hooks.failing = false
      const rows = await all(() => Item.find({ n: 1 }).lean().cache())
      expect(hooks.attempts).toBe(2)
      for (const result of rows) expect(result.map((row) => row.name)).toEqual(['a'])
    })

    it('runs a query of its own for every caller of a result that is not cached', async () => {
      const results = await all(() => Hooked.find({}).cache())
      expect(reads).toBe(CALLERS)
      for (const docs of results) {
        expect(docs[0]).toBeInstanceOf(Hooked)
        expect(docs.map((doc) => doc.name)).toEqual(['h hooked'])
      }
      expect(distinctObjects(results.map((docs) => docs[0]))).toBe(CALLERS)
    })

    it('runs an aggregate on its own when the query it shares a custom key with is not cached', async () => {
      const [docs, rows] = await Promise.all([
        Hooked.find({}).cache('1 minute', 'mixed-key').exec(),
        Item.aggregate([{ $match: { n: 1 } }, { $project: { _id: 0, name: 1 } }])
          .cache('1 minute', 'mixed-key')
          .exec(),
      ])
      expect(reads).toBe(2)
      expect(docs.map((doc) => doc.name)).toEqual(['h hooked'])
      expect(rows).toEqual([{ name: 'a' }])
    })

    it('never shares a query between different keys', async () => {
      const results = await Promise.all(
        Array.from({ length: CALLERS }, (_, i) =>
          Item.find({ n: (i % 2) + 1 })
            .lean()
            .cache(),
        ),
      )
      expect(reads).toBe(2)
      for (const [i, rows] of results.entries()) expect(rows.map((row) => row.name)).toEqual([i % 2 === 0 ? 'a' : 'b'])

      await Promise.all([Item.find({ n: 1 }).lean().cache('1 minute', 'one'), Item.find({ n: 1 }).lean().cache('1 minute', 'two'), Item.find({ n: 1 }).lean().cache('1 minute', 'three')])
      expect(reads).toBe(5)
    })

    it('never shares a query between two connections that are not open yet', async () => {
      const baseUri = `mongodb://${mongoose.connection.host}:${mongoose.connection.port}`
      for (const db of ['coalesce_conn_a', 'coalesce_conn_b']) {
        const conn = mongoose.connection.useDb(db)
        await conn.collection('conndocs').deleteMany({})
        await conn.collection('conndocs').insertOne({ name: db })
      }
      reads = 0
      const schema = new Schema({ name: String })
      const a = mongoose.createConnection()
      const b = mongoose.createConnection()
      try {
        const burst = (conn: mongoose.Connection) => Promise.all(Array.from({ length: CALLERS }, () => conn.model('ConnDoc', schema, 'conndocs').find().lean().cache().exec()))
        const fromA = burst(a)
        const fromB = burst(b)
        await Promise.all([a.openUri(`${baseUri}/coalesce_conn_a`), b.openUri(`${baseUri}/coalesce_conn_b`)])
        for (const rows of await fromA) expect(rows.map((row) => row.name)).toEqual(['coalesce_conn_a'])
        for (const rows of await fromB) expect(rows.map((row) => row.name)).toEqual(['coalesce_conn_b'])
        expect(reads).toBe(2)
      } finally {
        await a.close()
        await b.close()
      }
    })

    it('shares a query by its custom key', async () => {
      const [first, second] = await Promise.all([Item.find({ n: 1 }).lean().cache('1 minute', 'shared-key'), Item.find({ n: 2 }).lean().cache('1 minute', 'shared-key')])
      expect(reads).toBe(1)
      expect(second).toEqual(first)
      expect(second).not.toBe(first)
    })

    it('forgets every settled query, so that the next burst on a key runs again', async () => {
      const keys = 300
      // A TTL of 0 caches nothing: only a query still in flight can serve a caller.
      const burst = () =>
        Promise.all(
          Array.from({ length: keys * 2 }, (_, i) =>
            Item.find({ n: i % keys })
              .lean()
              .cache(0),
          ),
        )
      await burst()
      expect(reads).toBe(keys)
      await burst()
      expect(reads).toBe(keys * 2)
    })

    it.each([
      ['clear()', undefined],
      ['clear(key)', 'detach-key'],
    ])('lets a query after %s run on its own instead of joining one already in flight', async (_name, customKey) => {
      let open = () => {}
      hooks.gate = new Promise<void>((resolve) => {
        open = resolve
      })
      const query = () => Item.find({ n: 1 }).lean().cache('1 minute', customKey)
      const stale = query().exec()
      await vi.waitUntil(() => reads === 1)
      await Item.updateOne({ n: 1 }, { name: 'updated' })
      await cache.clear(customKey)
      const fresh = await query()
      open()
      expect((await stale).map((row) => row.name)).toEqual(['a'])
      expect(fresh.map((row) => row.name)).toEqual(['updated'])
    })
  })
}
