import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'

import { setTimeout as sleep } from 'node:timers/promises'
import IORedis from 'ioredis'
import { Cache } from '../src/cache/Cache'
import { closingServer } from './redis/tcp'

// What a user observes of the Redis engine while Redis is reachable: the stored keys, values and
// TTLs, the options object, and close(). Writes and FLUSHDBs db 14, so it runs only against a
// Redis named explicitly through REDIS_PORT.
const redisPort = process.env.REDIS_PORT

describe.skipIf(!redisPort)('redis engine contract (redis up)', () => {
  const connection = { host: process.env.REDIS_HOST ?? 'localhost', port: Number(redisPort), db: 14 }
  const raw = new IORedis({ ...connection, lazyConnect: true })
  const caches: Cache[] = []
  const cacheWith = (engineOptions: Record<string, unknown> = {}, onError = vi.fn()) => {
    const cache = new Cache({ engine: 'redis', engineOptions: { ...connection, ...engineOptions }, onError })
    caches.push(cache)
    return cache
  }

  beforeEach(async () => {
    await raw.flushdb()
  })

  afterAll(async () => {
    await Promise.all(caches.map((cache) => cache.close()))
    await raw.flushdb()
    await raw.quit()
  })

  it('stores a value as relaxed EJSON under the default prefix with its TTL rounded up to whole seconds', async () => {
    const cache = cacheWith()
    await cache.set('k', [{ a: 1, when: new Date('2024-01-02T00:00:00Z') }], 1500)
    expect(await raw.keys('*')).toEqual(['cache-mongoose:k'])
    expect(await raw.get('cache-mongoose:k')).toBe('[{"a":1,"when":{"$date":"2024-01-02T00:00:00Z"}}]')
    expect(await raw.ttl('cache-mongoose:k')).toBe(2)
  })

  it('stores with the default TTL of one minute when none is given', async () => {
    const cache = cacheWith()
    await cache.set('k', { n: 1 }, null)
    expect(await raw.ttl('cache-mongoose:k')).toBe(60)
  })

  it('reads back a stored value decoded from EJSON', async () => {
    const cache = cacheWith()
    await raw.set('cache-mongoose:ext', '[{"a":1,"when":{"$date":"2024-01-02T00:00:00Z"}}]')
    expect(await cache.get('ext')).toEqual([{ a: 1, when: new Date('2024-01-02T00:00:00Z') }])
  })

  it('returns undefined for a missing key without calling onError', async () => {
    const onError = vi.fn()
    const cache = cacheWith({}, onError)
    expect(await cache.get('missing')).toBeUndefined()
    expect(onError).not.toHaveBeenCalled()
  })

  it('deletes a key, and resolves for a key that does not exist', async () => {
    const cache = cacheWith()
    await raw.set('cache-mongoose:gone', '1')
    await raw.set('cache-mongoose:kept', '1')
    await cache.del('gone')
    await cache.del('never-set')
    expect(await raw.keys('*')).toEqual(['cache-mongoose:kept'])
  })

  it('uses the keyPrefix given in engineOptions', async () => {
    const cache = cacheWith({ keyPrefix: 'tenant:' })
    await cache.set('k', { n: 1 }, '1 minute')
    expect(await raw.keys('*')).toEqual(['tenant:k'])
  })

  it('writes the default keyPrefix into the engineOptions object and adds nothing else to it', () => {
    const engineOptions = { ...connection }
    caches.push(new Cache({ engine: 'redis', engineOptions }))
    expect(engineOptions).toEqual({ ...connection, keyPrefix: 'cache-mongoose:' })
  })

  it('close() quits: the connection leaves the server and later reads go to onError', async () => {
    const onError = vi.fn()
    const cache = new Cache({ engine: 'redis', engineOptions: { ...connection, connectionName: 'contract-close' }, onError })
    await cache.set('k', { n: 1 }, '1 minute')
    expect(await raw.client('LIST')).toContain('name=contract-close')

    await cache.close()

    expect(await raw.client('LIST')).not.toContain('name=contract-close')
    expect(await cache.get('k')).toBeUndefined()
    expect(onError).toHaveBeenCalledWith(new Error('Connection is closed.'))
  })
})

describe('redis engine close() while Redis is unreachable', () => {
  it('resolves at once and stops reconnecting', async () => {
    const server = await closingServer()
    const cache = new Cache({ engine: 'redis', engineOptions: { host: '127.0.0.1', port: server.port }, onError: () => {} })
    await vi.waitFor(() => expect(server.connections()).toBeGreaterThanOrEqual(2))

    const started = performance.now()
    await cache.close()
    expect(performance.now() - started).toBeLessThan(100)

    const attempts = server.connections()
    await sleep(500)
    expect(server.connections()).toBe(attempts)
    await server.close()
  })
})
