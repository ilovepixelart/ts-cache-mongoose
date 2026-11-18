import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'

import { setTimeout as sleep } from 'node:timers/promises'
import IORedis from 'ioredis'
import { Cache } from '../src/cache/Cache'
import { redisProxy, refusedPort, silentServer } from './redis/tcp'

import type { RedisOptions } from 'ioredis'

// A cache command that cannot reach Redis fails at once, so the query falls through to MongoDB
// without waiting for reconnection attempts.
const FAST_MS = 500

const timed = async <T>(run: () => Promise<T>): Promise<{ ms: number; value: T }> => {
  const started = performance.now()
  const value = await run()
  return { ms: performance.now() - started, value }
}

describe('redis engine while Redis is unreachable', () => {
  const caches: Cache[] = []
  const cacheAt = (port: number, onError = vi.fn()) => {
    const cache = new Cache({ engine: 'redis', engineOptions: { host: '127.0.0.1', port }, onError })
    caches.push(cache)
    return cache
  }

  afterAll(async () => {
    await Promise.all(caches.map((cache) => cache.close()))
  })

  it('fails a cold read and write against a stopped Redis at once, through onError', { timeout: 120_000 }, async () => {
    const onError = vi.fn()
    const cache = cacheAt(await refusedPort(), onError)
    await sleep(100)

    const { ms, value } = await timed(async () => {
      const cached = await cache.get('cold')
      await cache.set('cold', [{ a: 1 }], '1 minute')
      return cached
    })

    expect(value).toBeUndefined()
    expect(onError).toHaveBeenCalledTimes(2)
    expect(ms).toBeLessThan(FAST_MS)
  })

  it.each(['del', 'clear'] as const)('rejects %s against a stopped Redis at once', { timeout: 120_000 }, async (method) => {
    const cache = cacheAt(await refusedPort())
    await sleep(100)

    const started = performance.now()
    await expect(method === 'del' ? cache.del('k') : cache.clear()).rejects.toThrow()
    expect(performance.now() - started).toBeLessThan(FAST_MS)
  })

  it('bounds the wait for a first connection that never completes, then fails reads at once', { timeout: 10_000 }, async () => {
    const server = await silentServer()
    const onError = vi.fn()
    const cache = cacheAt(server.port, onError)

    const first = await timed(() => cache.get('cold'))
    const second = await timed(() => cache.get('cold'))

    expect(first.value).toBeUndefined()
    expect(second.value).toBeUndefined()
    expect(onError).toHaveBeenCalledTimes(2)
    expect(first.ms).toBeGreaterThanOrEqual(900)
    expect(first.ms).toBeLessThan(1500)
    expect(second.ms).toBeLessThan(FAST_MS)
    await server.close()
  })
})

// Writes keys under its own prefix through a local proxy, so it runs only against a Redis named
// explicitly through REDIS_PORT. It stays on db 0: ioredis re-selects another db on reconnect
// without handling the rejection when the connection closes first.
const redisPort = process.env.REDIS_PORT

describe.skipIf(!redisPort)('redis engine when Redis comes and goes', () => {
  const target = { host: process.env.REDIS_HOST ?? 'localhost', port: Number(redisPort) }
  const raw = new IORedis({ ...target, lazyConnect: true })
  const clean = async () => {
    const keys = await raw.keys('fail-fast:*')
    if (keys.length > 0) await raw.del(...keys)
  }
  const caches: Cache[] = []
  const proxies: Awaited<ReturnType<typeof redisProxy>>[] = []
  const proxyToRedis = async () => {
    const proxy = await redisProxy(target)
    proxies.push(proxy)
    return proxy
  }
  const cacheAt = (port: number, onError = vi.fn(), options: RedisOptions = {}) => {
    const cache = new Cache({ engine: 'redis', engineOptions: { host: '127.0.0.1', port, keyPrefix: 'fail-fast:', ...options }, onError })
    caches.push(cache)
    return cache
  }
  const roundTrip = async (cache: Cache, key: string) => {
    await cache.set(key, { n: 1 }, '1 minute')
    expect(await cache.get(key)).toEqual({ n: 1 })
  }

  beforeEach(clean)

  // Proxies close after the caches: a connection dropped while QUIT is in flight rejects close().
  afterAll(async () => {
    await Promise.all(caches.map((cache) => cache.close()))
    await Promise.all(proxies.map((proxy) => proxy.drop()))
    await clean()
    await raw.quit()
  })

  it('fails a read at once after Redis goes away, and caches again once it is back', { timeout: 120_000 }, async () => {
    const proxy = await proxyToRedis()
    const onError = vi.fn()
    const cache = cacheAt(proxy.port, onError)
    await vi.waitFor(() => roundTrip(cache, 'before'))

    await proxy.drop()
    const { ms, value } = await timed(() => cache.get('before'))
    expect(value).toBeUndefined()
    expect(onError).toHaveBeenCalledOnce()
    expect(ms).toBeLessThan(FAST_MS)

    await proxy.restore()
    await vi.waitFor(() => roundTrip(cache, 'after'), { timeout: 5000, interval: 100 })
  })

  it('fails a read that is in flight when Redis goes away at once', { timeout: 120_000 }, async () => {
    const proxy = await proxyToRedis()
    const onError = vi.fn()
    const cache = cacheAt(proxy.port, onError)
    await vi.waitFor(() => roundTrip(cache, 'before'))

    proxy.hold()
    const pending = cache.get('before')
    await sleep(50)
    await proxy.drop()
    const { ms, value } = await timed(() => pending)

    expect(value).toBeUndefined()
    expect(onError).toHaveBeenCalledOnce()
    expect(ms).toBeLessThan(FAST_MS)
  })

  it.each([
    ['the client connects at construction', {}],
    ['lazyConnect is set', { lazyConnect: true }],
  ])('serves a read issued before the first connection completes from Redis when %s', async (_, options) => {
    const proxy = await proxyToRedis()
    await raw.set('fail-fast:startup', '{"n":2}')
    const onError = vi.fn()
    const cache = cacheAt(proxy.port, onError, options)

    const { ms, value } = await timed(() => cache.get('startup'))

    expect(value).toEqual({ n: 2 })
    expect(onError).not.toHaveBeenCalled()
    expect(ms).toBeLessThan(FAST_MS)
  })

  it.each([
    ['the ioredis defaults', { enableOfflineQueue: true, maxRetriesPerRequest: 20 }],
    ['unlimited retries', { enableOfflineQueue: true, maxRetriesPerRequest: null }],
  ])('queues a read until Redis is reachable when engineOptions set %s', async (_, options) => {
    const proxy = await proxyToRedis()
    await proxy.drop()
    await raw.set('fail-fast:queued', '{"n":1}')
    const onError = vi.fn()
    const cache = cacheAt(proxy.port, onError, options)

    let settled = false
    const pending = cache.get('queued').finally(() => {
      settled = true
    })
    await sleep(400)
    expect(settled).toBe(false)

    await proxy.restore()
    expect(await pending).toEqual({ n: 1 })
    expect(onError).not.toHaveBeenCalled()
  })
})
