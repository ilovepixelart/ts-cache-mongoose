import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { serialize } from 'node:v8'
import { Cache } from '../src/cache/Cache'
import { MemoryCacheEngine } from '../src/cache/engine/MemoryCacheEngine'

const T0 = new Date('2026-01-01T00:00:00.000Z')

describe('MemoryCacheEngine expiry and sizing', () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(T0)
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  describe('expiry', () => {
    it('an entry is a hit up to and including its expiry instant and a miss one millisecond later', () => {
      const engine = new MemoryCacheEngine()
      engine.set('k', { v: 1 }, 1000)
      vi.setSystemTime(T0.getTime() + 1000)
      expect(engine.get('k')).toEqual({ v: 1 })
      vi.setSystemTime(T0.getTime() + 1001)
      expect(engine.get('k')).toBeUndefined()
    })

    it('an entry set without a ttl never expires', () => {
      const engine = new MemoryCacheEngine()
      engine.set('k', { v: 1 })
      vi.setSystemTime(T0.getTime() + 100 * 365 * 24 * 3600 * 1000)
      expect(engine.get('k')).toEqual({ v: 1 })
    })

    it('reading an expired key removes it', () => {
      const engine = new MemoryCacheEngine()
      engine.set('a', { v: 1 }, 10)
      engine.set('b', { v: 2 }, 60_000)
      vi.setSystemTime(T0.getTime() + 11)
      expect(engine.get('a')).toBeUndefined()
      expect(engine.size).toBe(1)
      expect(engine.get('b')).toEqual({ v: 2 })
    })

    it('setting an expired key again makes it live with the new ttl', () => {
      const engine = new MemoryCacheEngine()
      engine.set('k', { v: 1 }, 10)
      vi.setSystemTime(T0.getTime() + 11)
      engine.set('k', { v: 2 }, 10)
      expect(engine.get('k')).toEqual({ v: 2 })
      vi.setSystemTime(T0.getTime() + 22)
      expect(engine.get('k')).toBeUndefined()
    })

    it('expired entries are never returned, whatever else is written', () => {
      const engine = new MemoryCacheEngine()
      for (let i = 0; i < 100; i++) engine.set(`old${i}`, { i }, 10)
      vi.setSystemTime(T0.getTime() + 11)
      for (let i = 0; i < 100; i++) engine.set(`new${i}`, { i }, 60_000)
      for (let i = 0; i < 100; i++) expect(engine.get(`old${i}`)).toBeUndefined()
      for (let i = 0; i < 100; i++) expect(engine.get(`new${i}`)).toEqual({ i })
    })

    it('with maxEntries, the oldest entry is evicted when an expired one sits first', () => {
      const engine = new MemoryCacheEngine({ maxEntries: 3 })
      engine.set('a', { v: 1 }, 10)
      engine.set('b', { v: 2 }, 60_000)
      engine.set('c', { v: 3 }, 60_000)
      vi.setSystemTime(T0.getTime() + 11)
      engine.set('d', { v: 4 }, 60_000)
      expect(engine.get('a')).toBeUndefined()
      expect(engine.get('b')).toEqual({ v: 2 })
      expect(engine.get('c')).toEqual({ v: 3 })
      expect(engine.get('d')).toEqual({ v: 4 })
    })

    it('del and clear remove live and expired entries alike', () => {
      const engine = new MemoryCacheEngine({ sizeCalculation: () => 10 })
      engine.set('a', { v: 1 }, 10)
      engine.set('b', { v: 2 }, 60_000)
      vi.setSystemTime(T0.getTime() + 11)
      engine.del('a')
      expect(engine.size).toBe(1)
      expect(engine.totalBytes).toBe(10)
      engine.clear()
      expect(engine.size).toBe(0)
      expect(engine.totalBytes).toBe(0)
    })
  })

  describe('sizing', () => {
    it('with maxBytes, the default size is the v8.serialize byte length of the value', () => {
      const value = [{ _id: 'a', name: 'x'.repeat(50), n: 1, when: new Date(T0), tags: ['a', 'b'] }]
      const engine = new MemoryCacheEngine({ maxBytes: 1_000_000 })
      engine.set('k', value, '1 hour')
      expect(engine.totalBytes).toBe(serialize(value).byteLength)
    })

    it('with maxBytes, the default size drives eviction', () => {
      const value = { name: 'x'.repeat(100) }
      const one = serialize(value).byteLength
      const engine = new MemoryCacheEngine({ maxBytes: one * 2 })
      engine.set('a', value, '1 hour')
      engine.set('b', value, '1 hour')
      engine.set('c', value, '1 hour')
      expect(engine.get('a')).toBeUndefined()
      expect(engine.get('b')).toEqual(value)
      expect(engine.get('c')).toEqual(value)
      expect(engine.totalBytes).toBe(one * 2)
    })

    it('a non-positive maxBytes leaves the engine unbounded', () => {
      const engine = new MemoryCacheEngine({ maxBytes: 0 })
      for (let i = 0; i < 50; i++) engine.set(`k${i}`, { blob: 'x'.repeat(1000) }, '1 hour')
      expect(engine.size).toBe(50)
    })

    it('a custom sizeCalculation is called once per set with the value, with or without maxBytes', () => {
      for (const maxBytes of [undefined, 1_000_000]) {
        const sizeCalculation = vi.fn(() => 7)
        const engine = new MemoryCacheEngine({ maxBytes, sizeCalculation })
        const value = { v: 1 }
        engine.set('a', value, '1 hour')
        engine.set('b', value, '1 hour')
        expect(sizeCalculation).toHaveBeenCalledTimes(2)
        expect(sizeCalculation).toHaveBeenCalledWith(value)
        expect(engine.totalBytes).toBe(14)
      }
    })

    it('a custom sizeCalculation that throws fails set and stores nothing', () => {
      const engine = new MemoryCacheEngine({
        sizeCalculation: () => {
          throw new Error('cannot size')
        },
      })
      expect(() => engine.set('k', { v: 1 }, '1 hour')).toThrow('cannot size')
      expect(engine.get('k')).toBeUndefined()
      expect(engine.size).toBe(0)
    })

    it('Cache rejects set with the error of a custom sizeCalculation that throws', async () => {
      const cache = new Cache({
        engine: 'memory',
        sizeCalculation: () => {
          throw new Error('cannot size')
        },
      })
      await expect(cache.set('k', { v: 1 }, '1 hour')).rejects.toThrow('cannot size')
      expect(await cache.get('k')).toBeUndefined()
    })
  })
})
