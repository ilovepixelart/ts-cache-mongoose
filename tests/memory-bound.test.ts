import { describe, expect, it } from 'vitest'

import { Cache } from '../src/cache/Cache'
import { MemoryCacheEngine } from '../src/cache/engine/MemoryCacheEngine'

describe('MemoryCacheEngine bounded capacity', () => {
  describe('entry bound', () => {
    it('is unbounded by default so existing callers are unaffected', () => {
      const engine = new MemoryCacheEngine()
      for (let i = 0; i < 2000; i++) {
        engine.set(`k${i}`, { i }, '1 hour')
      }
      expect(engine.get('k0')).toEqual({ i: 0 })
      expect(engine.get('k1999')).toEqual({ i: 1999 })
    })

    it('ignores non-positive maxEntries and stays unbounded', () => {
      const engine = new MemoryCacheEngine({ maxEntries: 0 })
      for (let i = 0; i < 10; i++) {
        engine.set(`k${i}`, { i }, '1 hour')
      }
      expect(engine.get('k0')).toEqual({ i: 0 })
      expect(engine.get('k9')).toEqual({ i: 9 })
    })

    it('evicts the oldest entry once the bound is exceeded', () => {
      const engine = new MemoryCacheEngine({ maxEntries: 3 })
      engine.set('a', { v: 1 }, '1 hour')
      engine.set('b', { v: 2 }, '1 hour')
      engine.set('c', { v: 3 }, '1 hour')
      engine.set('d', { v: 4 }, '1 hour')
      expect(engine.get('a')).toBeUndefined()
      expect(engine.get('b')).toEqual({ v: 2 })
      expect(engine.get('c')).toEqual({ v: 3 })
      expect(engine.get('d')).toEqual({ v: 4 })
    })

    it('get() promotes the touched key so LRU order, not FIFO, drives eviction', () => {
      const engine = new MemoryCacheEngine({ maxEntries: 3 })
      engine.set('a', { v: 1 }, '1 hour')
      engine.set('b', { v: 2 }, '1 hour')
      engine.set('c', { v: 3 }, '1 hour')
      engine.get('a')
      engine.set('d', { v: 4 }, '1 hour')
      expect(engine.get('a')).toEqual({ v: 1 })
      expect(engine.get('b')).toBeUndefined()
      expect(engine.get('c')).toEqual({ v: 3 })
      expect(engine.get('d')).toEqual({ v: 4 })
    })

    it('repeatedly re-setting the same key does not grow the store past the bound', () => {
      const engine = new MemoryCacheEngine({ maxEntries: 5 })
      for (let i = 0; i < 100; i++) {
        engine.set('k', { i }, '1 hour')
      }
      expect(engine.size).toBe(1)
      expect(engine.get('k')).toEqual({ i: 99 })
    })

    it('Cache forwards maxEntries to the memory engine', async () => {
      const cache = new Cache({ engine: 'memory', maxEntries: 2 })
      await cache.set('a', { v: 1 }, '1 hour')
      await cache.set('b', { v: 2 }, '1 hour')
      await cache.set('c', { v: 3 }, '1 hour')
      expect(await cache.get('a')).toBeUndefined()
      expect(await cache.get('b')).toEqual({ v: 2 })
      expect(await cache.get('c')).toEqual({ v: 3 })
    })
  })

  describe('byte bound', () => {
    const fixedSizer = (_: unknown): number => 100

    it('defaults to v8.serialize so payload shape drives total bytes', () => {
      const engine = new MemoryCacheEngine({ maxBytes: 1_000_000 })
      engine.set('a', { hello: 'world' }, '1 hour')
      expect(engine.totalBytes).toBeGreaterThan(0)
      expect(engine.totalBytes).toBeLessThan(200)
    })

    it('tracks total bytes across set/del/clear', () => {
      const engine = new MemoryCacheEngine({ sizeCalculation: fixedSizer })
      engine.set('a', { v: 1 }, '1 hour')
      engine.set('b', { v: 2 }, '1 hour')
      expect(engine.totalBytes).toBe(200)
      engine.del('a')
      expect(engine.totalBytes).toBe(100)
      engine.clear()
      expect(engine.totalBytes).toBe(0)
    })

    it('replacing an existing key does not double-count its bytes', () => {
      const engine = new MemoryCacheEngine({ sizeCalculation: fixedSizer })
      engine.set('k', { v: 1 }, '1 hour')
      engine.set('k', { v: 2 }, '1 hour')
      engine.set('k', { v: 3 }, '1 hour')
      expect(engine.totalBytes).toBe(100)
      expect(engine.size).toBe(1)
    })

    it('evicts LRU entries until totalBytes is under maxBytes', () => {
      const engine = new MemoryCacheEngine({ maxBytes: 250, sizeCalculation: fixedSizer })
      engine.set('a', { v: 1 }, '1 hour')
      engine.set('b', { v: 2 }, '1 hour')
      engine.set('c', { v: 3 }, '1 hour')
      // After inserting 'c', totalBytes = 300, evict 'a'. totalBytes = 200.
      expect(engine.get('a')).toBeUndefined()
      expect(engine.get('b')).toEqual({ v: 2 })
      expect(engine.get('c')).toEqual({ v: 3 })
      expect(engine.totalBytes).toBe(200)
    })

    it('soft cap: a single oversized entry is kept and everything older is evicted', () => {
      const engine = new MemoryCacheEngine({
        maxBytes: 150,
        sizeCalculation: (v) => (v != null && typeof v === 'object' && 'huge' in v ? 10_000 : 100),
      })
      engine.set('a', { v: 1 }, '1 hour')
      engine.set('b', { huge: true }, '1 hour')
      // 'a' evicted to make room for the oversized entry; 'b' stays
      // because we never drop the just-written entry.
      expect(engine.get('a')).toBeUndefined()
      expect(engine.get('b')).toEqual({ huge: true })
      expect(engine.size).toBe(1)
    })

    it('expired entries evicted via get() decrement totalBytes', () => {
      const engine = new MemoryCacheEngine({ sizeCalculation: fixedSizer })
      engine.set('short', { v: 1 }, '1 millisecond')
      expect(engine.totalBytes).toBe(100)
      const deadline = Date.now() + 20
      while (Date.now() < deadline) {
        /* spin briefly */
      }
      expect(engine.get('short')).toBeUndefined()
      expect(engine.totalBytes).toBe(0)
    })

    it('Cache forwards maxBytes and sizeCalculation to the memory engine', async () => {
      const cache = new Cache({
        engine: 'memory',
        maxBytes: 250,
        sizeCalculation: fixedSizer,
      })
      await cache.set('a', { v: 1 }, '1 hour')
      await cache.set('b', { v: 2 }, '1 hour')
      await cache.set('c', { v: 3 }, '1 hour')
      expect(await cache.get('a')).toBeUndefined()
      expect(await cache.get('b')).toEqual({ v: 2 })
      expect(await cache.get('c')).toEqual({ v: 3 })
    })

    it('enforces whichever bound is hit first when both are set', () => {
      const engine = new MemoryCacheEngine({
        maxEntries: 10,
        maxBytes: 200,
        sizeCalculation: fixedSizer,
      })
      engine.set('a', { v: 1 }, '1 hour')
      engine.set('b', { v: 2 }, '1 hour')
      engine.set('c', { v: 3 }, '1 hour')
      // maxBytes (200) is hit before maxEntries (10).
      expect(engine.size).toBe(2)
      expect(engine.get('a')).toBeUndefined()
    })
  })
})
