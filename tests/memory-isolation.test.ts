import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'

import mongoose, { Schema } from 'mongoose'
import { MemoryCacheEngine } from '../src/cache/engine/MemoryCacheEngine'
import CacheMongoose from '../src/index'
import { server } from './mongo/server'

const IsolatedModel = mongoose.model('Isolated', new Schema({ a: Number, name: String, nested: { y: String }, mixed: Schema.Types.Mixed }))

describe('memory engine isolates stored values from callers', () => {
  describe('engine', () => {
    const OID = '64b7f0000000000000000001'
    const stored = () => {
      const bare: Record<string, unknown> = Object.create(null)
      bare.inner = { n: 1 }
      return {
        name: 'x',
        list: [{ n: 1 }],
        when: new Date('2026-01-01T00:00:00.000Z'),
        map: new Map([['k', { v: 1 }]]),
        buf: Buffer.from('ab'),
        bare,
        id: new mongoose.Types.ObjectId(OID),
      }
    }

    it('a change to the set value after set does not reach later gets', () => {
      const engine = new MemoryCacheEngine()
      const value = stored()
      engine.set('k', value, '1 hour')
      value.name = 'changed'
      value.list[0].n = 2
      value.when.setFullYear(2000)
      const entry = value.map.get('k')
      if (entry) entry.v = 2
      value.buf[0] = 0
      ;(value.bare.inner as { n: number }).n = 2
      expect(engine.get('k')).toStrictEqual(stored())
    })

    it('a change to a returned value does not reach later gets', () => {
      const engine = new MemoryCacheEngine()
      engine.set('k', [stored()], '1 hour')
      const first = engine.get('k') as ReturnType<typeof stored>[]
      first[0].name = 'changed'
      first[0].list.push({ n: 9 })
      first[0].buf.write('zz')
      first.push(stored())
      expect(engine.get('k')).toStrictEqual([stored()])
    })

    it('control: without changes a get equals the set value, prototypes included', () => {
      const engine = new MemoryCacheEngine()
      engine.set('k', stored(), '1 hour')
      const hit = engine.get('k') as ReturnType<typeof stored>
      expect(hit).toStrictEqual(stored())
      expect(Object.getPrototypeOf(hit.bare)).toBeNull()
      expect(hit.id).toBeInstanceOf(mongoose.Types.ObjectId)
      expect(Buffer.isBuffer(hit.buf)).toBe(true)
      expect(hit.map).toBeInstanceOf(Map)
    })

    it('control: numbers and undefined pass through', () => {
      const engine = new MemoryCacheEngine()
      engine.set('n', 3, '1 hour')
      expect(engine.get('n')).toBe(3)
      expect(engine.get('missing')).toBeUndefined()
    })
  })

  describe('queries', () => {
    const instance = server('memory-isolation')
    let cache: CacheMongoose

    beforeAll(async () => {
      cache = CacheMongoose.init(mongoose, { engine: 'memory' })
      await instance.create()
    })

    afterAll(async () => {
      await cache.clear()
      await cache.close()
      await instance.destroy()
    })

    beforeEach(async () => {
      await IsolatedModel.deleteMany({})
      await cache.clear()
      await IsolatedModel.create([
        { a: 1, name: 'x', nested: { y: 'n' }, mixed: { k: 1 } },
        { a: 2, name: 'y', nested: { y: 'm' }, mixed: { k: 2 } },
      ])
    })

    it('mutating a lean miss result does not change later hits', async () => {
      const first = await IsolatedModel.find({ a: 1 }).lean().cache()
      ;(first[0] as Record<string, unknown>).viewerOnly = 'user-42'
      const second = await IsolatedModel.find({ a: 1 }).lean().cache()
      expect((second[0] as Record<string, unknown>).viewerOnly).toBeUndefined()
    })

    it('mutating a lean hit does not change later hits', async () => {
      await IsolatedModel.find({ a: 1 }).lean().cache()
      const hit = await IsolatedModel.find({ a: 1 }).lean().cache()
      ;(hit[0].mixed as Record<string, unknown>).k = 'edited'
      const next = await IsolatedModel.find({ a: 1 }).lean().cache()
      expect(next[0].mixed).toEqual({ k: 1 })
    })

    // Non-lean results reach the engine as live documents, which it shares rather than copies.
    it.fails('an unsaved change on a non-lean miss result is not served by later hits', async () => {
      const first = await IsolatedModel.findOne({ a: 1 }).cache()
      if (first) first.name = 'unsaved-edit'
      const second = await IsolatedModel.findOne({ a: 1 }).cache()
      expect(second?.name).toBe('x')
    })

    it.fails('an unsaved Mixed change on a non-lean hit is not served by later hits', async () => {
      await IsolatedModel.findOne({ a: 1 }).cache()
      const hit = await IsolatedModel.findOne({ a: 1 }).cache()
      if (hit) (hit.mixed as Record<string, unknown>).k = 'edited'
      const next = await IsolatedModel.findOne({ a: 1 }).cache()
      expect(next?.mixed).toEqual({ k: 1 })
    })

    it('control: without mutation the hit equals the database', async () => {
      await IsolatedModel.findOne({ a: 1 }).cache()
      const second = await IsolatedModel.findOne({ a: 1 }).cache()
      expect(second?.name).toBe('x')
      const lean = await IsolatedModel.find({ a: 1 }).lean().cache()
      const leanHit = await IsolatedModel.find({ a: 1 }).lean().cache()
      expect(leanHit).toEqual(lean)
    })
  })
})
