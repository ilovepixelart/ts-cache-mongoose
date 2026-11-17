import { afterAll, beforeEach, describe, expect, it } from 'vitest'

import IORedis from 'ioredis'
import { RedisCacheEngine } from '../src/cache/engine/RedisCacheEngine'

const connection = { host: 'localhost', port: Number(process.env.REDIS_PORT ?? 6379), db: 9 }

describe('RedisCacheEngine.clear', () => {
  const raw = new IORedis(connection)

  beforeEach(async () => {
    await raw.flushdb()
  })

  afterAll(async () => {
    await raw.flushdb()
    await raw.quit()
  })

  const engineWith = (keyPrefix?: string) => new RedisCacheEngine({ ...connection, ...(keyPrefix === undefined ? {} : { keyPrefix }) }, () => {})

  it('deletes the keys under its prefix and leaves every other key in the database', async () => {
    const engine = engineWith()
    await engine.set('a', { n: 1 }, '1 minute')
    await engine.set('b', { n: 2 }, '1 minute')
    await raw.set('session:42', 'kept')
    await raw.set('cache-mongoose', 'kept: the prefix without its colon')
    await raw.set('other-app:cache-mongoose:x', 'kept: the prefix not at the start')
    expect((await raw.keys('cache-mongoose:*')).sort()).toEqual(['cache-mongoose:a', 'cache-mongoose:b'])

    await engine.clear()

    expect((await raw.keys('*')).sort()).toEqual(['cache-mongoose', 'other-app:cache-mongoose:x', 'session:42'])
    await engine.close()
  })

  it('deletes keys beyond a single scan batch', async () => {
    const engine = engineWith()
    const pipeline = raw.pipeline()
    for (let i = 0; i < 2500; i++) pipeline.set(`cache-mongoose:k${i}`, '1')
    await pipeline.exec()
    await raw.set('unrelated', '1')

    await engine.clear()

    expect(await raw.keys('*')).toEqual(['unrelated'])
    await engine.close()
  })

  it('matches a prefix with glob characters literally', async () => {
    const engine = engineWith('tenant[1]*?:')
    await engine.set('a', { n: 1 }, '1 minute')
    await raw.set('tenant1x?:a', 'kept: matches the prefix only as a glob')
    await raw.set('tenant[1]*?', 'kept: the prefix without its colon')
    expect(await raw.exists('tenant[1]*?:a')).toBe(1)

    await engine.clear()

    expect((await raw.keys('*')).sort()).toEqual(['tenant1x?:a', 'tenant[1]*?'])
    await engine.close()
  })
})
