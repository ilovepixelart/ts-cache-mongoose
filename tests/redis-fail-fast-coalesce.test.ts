import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'

import { setTimeout as sleep } from 'node:timers/promises'
import mongoose, { Schema } from 'mongoose'
import CacheMongoose from '../src/index'
import { server } from './mongo/server'
import { refusedPort } from './redis/tcp'

// Concurrent identical cold queries while Redis is down: every cache read fails at once, so the
// callers reach the shared load together and MongoDB still sees one round trip.
const CALLERS = 50

const Item = mongoose.model('FailFastCoalesceItem', new Schema({ name: String, n: Number }))

describe('redis engine down with coalescing', () => {
  const instance = server('redis-fail-fast-coalesce')
  const onError = vi.fn()
  let reads = 0
  let cache: CacheMongoose

  beforeAll(async () => {
    cache = CacheMongoose.init(mongoose, { engine: 'redis', engineOptions: { host: '127.0.0.1', port: await refusedPort() }, onError })
    await instance.create()
    await Item.create([
      { name: 'a', n: 1 },
      { name: 'b', n: 1 },
    ])
    mongoose.set('debug', (_collection: string, method: string) => {
      if (method === 'find') reads++
    })
    await sleep(100)
  })

  afterAll(async () => {
    mongoose.set('debug', false)
    await cache.close()
    await instance.destroy()
  })

  it('answers 50 parallel identical cold queries at once from one MongoDB round trip', { timeout: 120_000 }, async () => {
    const started = performance.now()
    const results = await Promise.all(Array.from({ length: CALLERS }, () => Item.find({ n: 1 }).sort({ name: 1 }).lean().cache('1 minute').exec()))
    const ms = performance.now() - started

    expect(reads).toBe(1)
    for (const result of results)
      expect(result.map(({ name, n }) => ({ name, n }))).toEqual([
        { name: 'a', n: 1 },
        { name: 'b', n: 1 },
      ])
    expect(new Set(results).size).toBe(CALLERS)
    expect(onError).toHaveBeenCalledTimes(CALLERS + 1)
    expect(ms).toBeLessThan(1000)
  })
})
