import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

import { serialize } from 'node:v8'
import mongoose, { Schema } from 'mongoose'
import { Cache } from '../src/cache/Cache'
import { MemoryCacheEngine } from '../src/cache/engine/MemoryCacheEngine'
import CacheMongoose from '../src/index'
import { server } from './mongo/server'

const T0 = new Date('2026-01-01T00:00:00.000Z').getTime()
const row = (i: number) => [{ _id: `id-${i}`, name: `user-${i}`, bio: 'x'.repeat(900) }]

// v8.serialize cannot clone a Proxy, which is what a mongoose 7+ array is.
const unserializable = () => ({ tags: new Proxy(['a', 'b'], {}) })

type Chain = { next?: Chain; depth?: number }
const chain = (depth: number): Chain => {
  const root: Chain = {}
  let node = root
  for (let i = 0; i < depth; i++) {
    node.next = {}
    node = node.next
  }
  node.depth = depth
  return root
}

const SizedModel = mongoose.model('Sized', new Schema({ name: String, tags: [String], subs: [{ x: Number }], nested: { y: String } }))

describe('memory engine expiry sweep', () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(T0)
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('expired entries for keys never read again are reclaimed by later sets', () => {
    const keys = 20_000
    const engine = new MemoryCacheEngine({ sizeCalculation: () => 1000 })
    for (let i = 0; i < keys; i++) engine.set(`old${i}`, row(i), 5)
    vi.setSystemTime(T0 + 50)
    for (let i = 0; i < keys; i++) engine.set(`fresh${i}`, row(i), 60_000)
    expect(engine.size).toBe(keys)
    expect(engine.totalBytes).toBe(keys * 1000)
  })

  it('a steady stream of short-lived unique keys keeps the store near its live size', () => {
    const engine = new MemoryCacheEngine()
    let largest = 0
    for (let i = 0; i < 50_000; i++) {
      vi.setSystemTime(T0 + i)
      engine.set(`k${i}`, row(i), 10)
      largest = Math.max(largest, engine.size)
    }
    expect(largest).toBeLessThanOrEqual(100)
  })

  it('long-lived entries written first do not stop expired entries behind them from being reclaimed', () => {
    const engine = new MemoryCacheEngine()
    for (let i = 0; i < 100; i++) engine.set(`pinned${i}`, { i }, '1 day')
    for (let i = 0; i < 1000; i++) engine.set(`old${i}`, row(i), 5)
    vi.setSystemTime(T0 + 50)
    for (let i = 0; i < 1000; i++) engine.set(`fresh${i}`, row(i), 60_000)
    expect(engine.size).toBe(1100)
    for (let i = 0; i < 100; i++) expect(engine.get(`pinned${i}`)).toEqual({ i })
  })

  it('control: a set does not remove an entry at its expiry instant, which get() still serves', () => {
    const engine = new MemoryCacheEngine()
    engine.set('k', { v: 1 }, 1000)
    vi.setSystemTime(T0 + 1000)
    engine.set('other', { v: 2 }, 1000)
    expect(engine.get('k')).toEqual({ v: 1 })
  })

  it('the sweep keeps reclaiming expired entries after clear()', () => {
    const engine = new MemoryCacheEngine()
    for (let i = 0; i < 100; i++) engine.set(`before${i}`, row(i), 5)
    engine.clear()
    for (let i = 0; i < 1000; i++) engine.set(`old${i}`, row(i), 5)
    vi.setSystemTime(T0 + 50)
    for (let i = 0; i < 1000; i++) engine.set(`fresh${i}`, row(i), 60_000)
    expect(engine.size).toBe(1000)
  })

  it('control: entries that have not expired are all kept', () => {
    const engine = new MemoryCacheEngine()
    for (let i = 0; i < 2000; i++) engine.set(`k${i}`, row(i), 60_000)
    vi.setSystemTime(T0 + 50)
    for (let i = 0; i < 2000; i++) engine.set(`fresh${i}`, row(i), 60_000)
    expect(engine.size).toBe(4000)
    for (let i = 0; i < 2000; i++) expect(engine.get(`k${i}`)).toEqual(row(i))
  })
})

describe('memory engine sizing', () => {
  it('without maxBytes, the default sizer computes no size', () => {
    const engine = new MemoryCacheEngine()
    engine.set('k', { blob: 'x'.repeat(1000) }, '1 hour')
    expect(engine.totalBytes).toBe(0)
  })

  it('without maxBytes, a value v8.serialize cannot clone is stored', () => {
    const engine = new MemoryCacheEngine()
    expect(() => engine.set('k', unserializable(), '1 hour')).not.toThrow()
    expect(engine.get('k')).toEqual({ tags: ['a', 'b'] })
  })

  it('with maxBytes, a value v8.serialize cannot clone is stored with an estimated size', () => {
    const engine = new MemoryCacheEngine({ maxBytes: 1_000_000 })
    expect(() => engine.set('k', unserializable(), '1 hour')).not.toThrow()
    expect(engine.get('k')).toEqual({ tags: ['a', 'b'] })
    expect(engine.totalBytes).toBeGreaterThan(0)
  })

  it('with maxBytes, the estimate grows with the payload and drives eviction', () => {
    const big = {
      tags: new Proxy(
        Array.from({ length: 1000 }, (_, i) => `tag-${i}`),
        {},
      ),
    }
    const small = unserializable()
    const sizes = [big, small].map((value) => {
      const engine = new MemoryCacheEngine({ maxBytes: 1_000_000 })
      engine.set('k', value, '1 hour')
      return engine.totalBytes
    })
    expect(sizes[0]).toBeGreaterThan(sizes[1] * 100)
    const engine = new MemoryCacheEngine({ maxBytes: sizes[0] * 1.5 })
    engine.set('a', big, '1 hour')
    engine.set('b', big, '1 hour')
    expect(engine.get('a')).toBeUndefined()
    expect(engine.get('b')).toBeDefined()
  })

  it('with maxBytes, the estimate counts Map entries', () => {
    const engine = new MemoryCacheEngine({ maxBytes: 1_000_000 })
    engine.set('k', { ...unserializable(), map: new Map([['k', 'x'.repeat(5000)]]) }, '1 hour')
    expect(engine.totalBytes).toBeGreaterThan(5000)
  })

  it('with maxBytes, binary data is estimated by its byte length', () => {
    const engine = new MemoryCacheEngine({ maxBytes: 1_000_000 })
    engine.set('k', { ...unserializable(), bytes: Buffer.alloc(30_000) }, '1 hour')
    expect(engine.totalBytes).toBeGreaterThan(30_000)
    expect(engine.totalBytes).toBeLessThan(31_000)
  })

  it('with maxBytes, a value nested too deep for v8.serialize is stored', () => {
    const engine = new MemoryCacheEngine({ maxBytes: 1_000_000 })
    expect(() => engine.set('k', chain(10_000) as Record<string, unknown>, '1 hour')).not.toThrow()
    expect(engine.totalBytes).toBeGreaterThan(0)
  })

  const hydrate = () => SizedModel.hydrate({ _id: new mongoose.Types.ObjectId(), name: 'user'.repeat(50), tags: ['a', 'b', 'c'], subs: [{ x: 1, _id: new mongoose.Types.ObjectId() }], nested: { y: 'n' }, __v: 0 })
  const hydrated = hydrate()
  const cannotSerialize = (() => {
    try {
      serialize(hydrated)
      return false
    } catch {
      return true
    }
  })()

  it.runIf(cannotSerialize)('with maxBytes, a live document is estimated from its data, close to the v8.serialize size of that data', () => {
    const docs = Array.from({ length: 100 }, hydrate)
    const engine = new MemoryCacheEngine({ maxBytes: 1_000_000_000 })
    engine.set('k', docs as unknown as Record<string, unknown>[], '1 hour')
    const reference = serialize(docs.map((d) => d.toObject())).byteLength
    expect(engine.totalBytes).toBeGreaterThan(reference * 0.5)
    expect(engine.totalBytes).toBeLessThan(reference * 1.5)
  })

  it('Cache with maxBytes stores a value v8.serialize cannot clone', async () => {
    const cache = new Cache({ engine: 'memory', maxBytes: 1_000_000 })
    await cache.set('k', unserializable(), '1 hour')
    expect(await cache.get('k')).toEqual({ tags: ['a', 'b'] })
  })

  it('control: a serializable value is still sized by v8.serialize with maxBytes', () => {
    const engine = new MemoryCacheEngine({ maxBytes: 1_000_000 })
    engine.set('k', { tags: ['a', 'b'] }, '1 hour')
    expect(engine.totalBytes).toBeGreaterThan(0)
  })
})

const DeepSchema = new Schema({ name: String })
DeepSchema.post('find', (docs: { deep?: Chain }[]) => {
  for (const doc of docs) doc.deep = chain(10_000)
})
const DeepModel = mongoose.model('SizedDeep', DeepSchema)

describe('queries with the default memory options', () => {
  const instance = server('memory-expiry-sizer')
  let cache: CacheMongoose
  let ops = 0
  const errors: Error[] = []

  beforeAll(async () => {
    cache = CacheMongoose.init(mongoose, { engine: 'memory', onError: (e) => errors.push(e) })
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
    await SizedModel.deleteMany({})
    await DeepModel.deleteMany({})
    await cache.clear()
    await SizedModel.create({ name: 'x', tags: ['a', 'b'], subs: [{ x: 1 }], nested: { y: 'n' } })
    await DeepModel.create({ name: 'deep' })
    ops = 0
    errors.length = 0
  })

  it('a non-lean find on a schema with array paths is cached without errors', async () => {
    const miss = await SizedModel.find().cache()
    const hit = await SizedModel.find().cache()
    expect(ops).toBe(1)
    expect(errors).toEqual([])
    expect(hit.map((d) => d.toObject())).toEqual(miss.map((d) => d.toObject()))
  })

  it('a non-lean findOne on a schema with array paths is cached without errors', async () => {
    const miss = await SizedModel.findOne().cache()
    const hit = await SizedModel.findOne().cache()
    expect(ops).toBe(1)
    expect(errors).toEqual([])
    expect(hit?.toObject()).toEqual(miss?.toObject())
  })

  it('a lean result nested too deep for v8.serialize is cached without errors', async () => {
    await DeepModel.find().lean().cache()
    await DeepModel.find().lean().cache()
    expect(ops).toBe(1)
    expect(errors).toEqual([])
  })

  it('control: a lean find is cached without errors', async () => {
    const miss = await SizedModel.find().lean().cache()
    const hit = await SizedModel.find().lean().cache()
    expect(ops).toBe(1)
    expect(errors).toEqual([])
    expect(hit).toEqual(miss)
  })
})
