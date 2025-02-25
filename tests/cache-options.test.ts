import { describe, expect, it, vi } from 'vitest'
import { Cache } from '../src/cache/Cache'

import type { CacheOptions } from '../src/types'

describe('Cache class tests', () => {
  it('should create a new instance of Cache', () => {
    const cacheOptions: CacheOptions = {
      engine: 'memory',
    }

    const cache = new Cache(cacheOptions)
    expect(cache).toBeInstanceOf(Cache)
    expect(cache).toHaveProperty('get')
    expect(cache).toHaveProperty('set')
    expect(cache).toHaveProperty('del')
    expect(cache).toHaveProperty('clear')
    expect(cache).toHaveProperty('close')
  })

  it('should throw an error if the cache engine is not supported', () => {
    const cacheOptions: CacheOptions = {
      // @ts-expect-error Testing invalid engine name
      engine: 'not-supported',
    }

    expect(() => new Cache(cacheOptions)).toThrow(`Invalid engine name: ${cacheOptions.engine}`)
  })

  it('should throw an error if the cache engine is redis and no engine options are provided', () => {
    const cacheOptions: CacheOptions = {
      engine: 'redis',
    }

    expect(() => new Cache(cacheOptions)).toThrow(`Engine options are required for ${cacheOptions.engine} engine`)
  })

  it('should create a new instance of Cache with redis engine', async () => {
    const cacheOptions: CacheOptions = {
      engine: 'redis',
      engineOptions: {
        host: 'localhost',
        port: 6379,
      },
      defaultTTL: '10 minutes',
    }

    const cache = new Cache(cacheOptions)
    expect(cache).toBeInstanceOf(Cache)
    expect(cache).toHaveProperty('get')
    expect(cache).toHaveProperty('set')
    expect(cache).toHaveProperty('del')
    expect(cache).toHaveProperty('clear')
    expect(cache).toHaveProperty('close')

    await cache.set('bob', { test: 'bob' }, null)
    await cache.set('john', { test: 'john' }, '1 minute')

    const value = await cache.get('bob')
    expect(value).toEqual({ test: 'bob' })

    await cache.del('bob')
    const clearBob = await cache.get('bob')
    expect(clearBob).toBeUndefined()

    const john = await cache.get('john')
    expect(john).toEqual({ test: 'john' })

    await cache.clear()
    const clearJohn = await cache.get('john')
    expect(clearJohn).toBeUndefined()

    const mockSet = vi.fn()
    cache.set = mockSet

    await cache.set('bob', { test: 'bob' }, null)
    expect(mockSet).toHaveBeenCalled()
    expect(mockSet).toHaveBeenCalledWith('bob', { test: 'bob' }, null)

    await cache.close()
  })
})
