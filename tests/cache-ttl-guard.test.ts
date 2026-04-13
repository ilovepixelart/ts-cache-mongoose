import { describe, expect, it, vi } from 'vitest'

import { Cache } from '../src/cache/Cache'
import { MemoryCacheEngine } from '../src/cache/engine/MemoryCacheEngine'

describe('Cache.set non-positive TTL guard', () => {
  it('does not touch the engine when actualTTL is 0', async () => {
    const cache = new Cache({ engine: 'memory' })
    const spy = vi.spyOn(MemoryCacheEngine.prototype, 'set')
    await cache.set('k', { a: 1 }, '0 seconds')
    expect(spy).not.toHaveBeenCalled()
    spy.mockRestore()
  })

  it('does not touch the engine when actualTTL is negative', async () => {
    const cache = new Cache({ engine: 'memory' })
    const spy = vi.spyOn(MemoryCacheEngine.prototype, 'set')
    await cache.set('k', { a: 1 }, '-1 minute')
    expect(spy).not.toHaveBeenCalled()
    spy.mockRestore()
  })

  it('does not touch the engine when the duration parses to NaN', async () => {
    const cache = new Cache({ engine: 'memory' })
    const spy = vi.spyOn(MemoryCacheEngine.prototype, 'set')
    // biome-ignore lint/suspicious/noExplicitAny: exercising runtime guard with garbage input
    await cache.set('k', { a: 1 }, 'nonsense' as any)
    expect(spy).not.toHaveBeenCalled()
    spy.mockRestore()
  })

  it('still writes when the TTL is healthy', async () => {
    const cache = new Cache({ engine: 'memory' })
    const spy = vi.spyOn(MemoryCacheEngine.prototype, 'set')
    await cache.set('k', { a: 1 }, '30 seconds')
    expect(spy).toHaveBeenCalledTimes(1)
    expect(spy).toHaveBeenCalledWith('k', { a: 1 }, 30000)
    spy.mockRestore()
  })

  it('falls back to defaultTTL when ttl is null', async () => {
    const cache = new Cache({ engine: 'memory', defaultTTL: '45 seconds' })
    const spy = vi.spyOn(MemoryCacheEngine.prototype, 'set')
    await cache.set('k', { a: 1 }, null)
    expect(spy).toHaveBeenCalledWith('k', { a: 1 }, 45000)
    spy.mockRestore()
  })

  it('still writes via the real engine end-to-end after the guard is satisfied', async () => {
    const cache = new Cache({ engine: 'memory' })
    await cache.set('alive', { hello: 'world' }, '1 minute')
    expect(await cache.get('alive')).toEqual({ hello: 'world' })
  })
})
