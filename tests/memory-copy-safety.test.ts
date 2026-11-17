import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'

import mongoose, { Schema } from 'mongoose'
import { MemoryCacheEngine } from '../src/cache/engine/MemoryCacheEngine'
import CacheMongoose from '../src/index'
import { server } from './mongo/server'

const DEPTH = 10_000

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

const chainDepth = (root: Chain): number => {
  let depth = 0
  let node = root
  while (node.next) {
    node = node.next
    depth++
  }
  return node.depth === depth ? depth : -1
}

const cyclic = () => {
  const shared = { s: 1 }
  const root: Record<string, unknown> = { list: [shared, shared] }
  root.self = root
  ;(root.list as unknown[]).push(root.list)
  return root
}

// Asserted structurally: a deep-equality matcher cannot be used on a cycle it has to walk.
const expectCyclicShape = (value: unknown) => {
  const root = value as { self: unknown; list: unknown[] }
  expect(root.self).toBe(root)
  expect(root.list[0]).toBe(root.list[1])
  expect(root.list[0]).toEqual({ s: 1 })
  expect(root.list[2]).toBe(root.list)
}

type Hooked = { name: string; meta?: unknown; deep?: Chain; loop?: unknown; trap?: unknown }

const SafetySchema = new Schema({ name: String, meta: Schema.Types.Mixed })
SafetySchema.post('find', (docs: Hooked[]) => {
  for (const doc of docs) {
    if (doc.name === 'deep') doc.deep = chain(DEPTH)
    if (doc.name === 'loop') doc.loop = cyclic()
    if (doc.name === 'trap') {
      doc.trap = {}
      Object.defineProperty(doc.trap, 'boom', {
        enumerable: true,
        get() {
          throw new Error('getter failed')
        },
      })
    }
  }
})
const SafetyModel = mongoose.model('Safety', SafetySchema)

describe('memory engine copy safety', () => {
  describe('engine', () => {
    it('an own __proto__ key stays an own key and does not change the prototype', () => {
      const engine = new MemoryCacheEngine()
      const value = JSON.parse('{"meta":{"__proto__":{"isAdmin":true},"constructor":{"x":1},"prototype":2}}') as { meta: Record<string, unknown> }
      engine.set('k', value, '1 hour')
      const hit = engine.get('k') as { meta: Record<string, unknown> }
      expect(Object.getPrototypeOf(hit.meta)).toBe(Object.prototype)
      expect(hit.meta.isAdmin).toBeUndefined()
      expect(Object.hasOwn(hit.meta, '__proto__')).toBe(true)
      expect(Object.getOwnPropertyDescriptor(hit.meta, '__proto__')?.value).toEqual({ isAdmin: true })
      expect(Object.hasOwn(hit.meta, 'constructor')).toBe(true)
      expect(hit.meta.constructor).toEqual({ x: 1 })
      expect(hit.meta.prototype).toBe(2)
    })

    it(`a value nested ${DEPTH} levels deep is stored and returned`, () => {
      // The default size calculation (v8.serialize) recurses and overflows at this depth.
      const engine = new MemoryCacheEngine({ sizeCalculation: () => 1 })
      expect(() => engine.set('k', chain(DEPTH) as Record<string, unknown>, '1 hour')).not.toThrow()
      expect(chainDepth(engine.get('k') as Chain)).toBe(DEPTH)
    })

    it('a cyclic value with shared references is stored and returned with the same shape', () => {
      const engine = new MemoryCacheEngine()
      expect(() => engine.set('k', cyclic(), '1 hour')).not.toThrow()
      expectCyclicShape(engine.get('k'))
    })

    it('a value that cannot be copied fails set and leaves the previous entry in place', () => {
      const engine = new MemoryCacheEngine()
      engine.set('k', { v: 1 }, '1 hour')
      const trap = {}
      Object.defineProperty(trap, 'boom', {
        enumerable: true,
        get() {
          throw new Error('getter failed')
        },
      })
      expect(() => engine.set('k', trap as Record<string, unknown>, '1 hour')).toThrow('getter failed')
      expect(engine.get('k')).toEqual({ v: 1 })
      expect(engine.size).toBe(1)
    })
  })

  describe('queries', () => {
    const instance = server('memory-copy-safety')
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
      await SafetyModel.deleteMany({})
      await cache.clear()
      // Inserted past mongoose so the JSON keys reach MongoDB as they are.
      await SafetyModel.collection.insertOne({ name: 'proto', meta: JSON.parse('{"__proto__":{"isAdmin":true},"constructor":{"x":1},"prototype":2}') })
      await SafetyModel.collection.insertMany([{ name: 'deep' }, { name: 'loop' }, { name: 'trap' }])
      ops = 0
      errors.length = 0
    })

    it('a lean hit keeps an own __proto__ key of a Mixed field as data', async () => {
      const uncached = await SafetyModel.find({ name: 'proto' }).lean()
      const miss = await SafetyModel.find({ name: 'proto' }).lean().cache()
      const hit = await SafetyModel.find({ name: 'proto' }).lean().cache()
      expect(ops).toBe(2)
      const meta = hit[0].meta as Record<string, unknown>
      expect(Object.getPrototypeOf(meta)).toBe(Object.prototype)
      expect(meta.isAdmin).toBeUndefined()
      expect(Object.hasOwn(meta, '__proto__')).toBe(true)
      expect(hit).toEqual(miss)
      expect(hit).toEqual(uncached)
      expect(errors).toEqual([])
    })

    it(`a lean result nested ${DEPTH} levels deep is returned in full`, async () => {
      const first = await SafetyModel.find({ name: 'deep' }).lean().cache()
      const second = await SafetyModel.find({ name: 'deep' }).lean().cache()
      expect(chainDepth((first[0] as Hooked).deep as Chain)).toBe(DEPTH)
      expect(chainDepth((second[0] as Hooked).deep as Chain)).toBe(DEPTH)
    })

    it('a cyclic lean result is cached and returned with the same shape', async () => {
      await SafetyModel.find({ name: 'loop' }).lean().cache()
      const hit = await SafetyModel.find({ name: 'loop' }).lean().cache()
      expectCyclicShape((hit[0] as Hooked).loop)
      expect(ops).toBe(1)
      expect(errors).toEqual([])
    })

    it('a result that cannot be copied is returned uncached and reported to onError', async () => {
      const first = await SafetyModel.find({ name: 'trap' }).lean().cache()
      const second = await SafetyModel.find({ name: 'trap' }).lean().cache()
      expect(first[0].name).toBe('trap')
      expect(second[0].name).toBe('trap')
      expect(ops).toBe(2)
      expect(errors.map((e) => e.message)).toEqual(['getter failed', 'getter failed'])
    })
  })
})
