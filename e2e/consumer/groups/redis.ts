import assert from 'node:assert/strict'
import IORedis from 'ioredis'
import mongoose from 'mongoose'
import { redisProxy } from '../../../tests/redis/tcp.ts'
import { observe, Run, reads, sleep } from '../harness.ts'
import { models } from '../models.ts'
import { queries } from './queries.ts'

import type { Context, Result } from '../harness.ts'

// The Redis engine against a real Redis: the shared scenarios, keyPrefix scoping of clear(), and
// Redis going away and coming back (through a TCP proxy in front of the real server).

const FAIL_FAST_MS = 3000

export const redis = async (ctx: Context): Promise<Result[]> => {
  const cache = await ctx.loaders.load()
  const onErrors: Error[] = []
  const instance = cache.init(mongoose, { engine: 'redis', defaultTTL: '1 minute', onError: (err) => onErrors.push(err), engineOptions: { ...ctx.redis, keyPrefix: ctx.prefix } })
  const run = new Run(async () => {
    await instance.clear()
    onErrors.length = 0
  })
  await queries({ ctx, run, instance, onErrors })

  const client = new IORedis({ ...ctx.redis, lazyConnect: true })
  await client.connect()
  try {
    await run.scenario('entries live under engineOptions.keyPrefix and clear() leaves other keys alone', async () => {
      const foreign = `${ctx.prefix.slice(0, -1)}-foreign`
      await client.set(foreign, 'kept')
      await models(mongoose.connection).Book.find({}).lean().cache()
      const entries = (await client.keys(`${ctx.prefix}*`)).length
      await instance.clear()
      const afterClear = (await client.keys(`${ctx.prefix}*`)).length
      const kept = await client.get(foreign)
      await client.del(foreign)
      assert.deepEqual({ entries, afterClear, kept }, { entries: 1, afterClear: 0, kept: 'kept' })
      return { entries, afterClear, kept }
    })
  } finally {
    client.disconnect()
  }

  await run.scenario('close() releases Redis and later queries still return MongoDB data', async () => {
    await instance.close()
    onErrors.length = 0
    const rows = await models(mongoose.connection).Book.find({ genre: 'scifi' }).lean().cache()
    assert.equal(rows.length, 1)
    return { rows: rows.length, onErrorCalled: onErrors.length > 0 }
  })
  return run.results
}

// A query against a Redis that is down: correct data, from MongoDB, without waiting for Redis.
const fallsThrough = async (onErrors: Error[]) => {
  const { Book } = models(mongoose.connection)
  const truth = observe(await Book.find({}).sort({ title: 1 }).lean())
  reads.count = 0
  const started = Date.now()
  const results = await Promise.all(Array.from({ length: 50 }, () => Book.find({}).sort({ title: 1 }).lean().cache()))
  const elapsed = Date.now() - started
  for (const result of results) assert.deepEqual(observe(result), truth, 'a query with Redis down returned wrong data')
  assert.ok(elapsed < FAIL_FAST_MS, `50 cold queries with Redis down took ${elapsed} ms, expected under ${FAIL_FAST_MS} ms`)
  assert.ok(onErrors.length > 0, 'onError was not called with Redis down')
  return { roundTrips: reads.count, onErrorCalled: true }
}

// Polls until a repeated query is a hit again.
const resumes = async () => {
  const { Book } = models(mongoose.connection)
  const deadline = Date.now() + 12_000
  while (Date.now() < deadline) {
    await Book.find({ genre: 'scifi' }).lean().cache()
    const before = reads.count
    await Book.find({ genre: 'scifi' }).lean().cache()
    if (reads.count === before) return { resumed: true }
    await sleep(200)
  }
  throw new Error('caching did not resume within 12 s after Redis came back')
}

export const redisDown = async (ctx: Context): Promise<Result[]> => {
  const cache = await ctx.loaders.load()
  const onErrors: Error[] = []
  const proxy = await redisProxy(ctx.redis)
  await proxy.drop()
  const instance = cache.init(mongoose, { engine: 'redis', defaultTTL: '1 minute', onError: (err) => onErrors.push(err), engineOptions: { host: '127.0.0.1', port: proxy.port, keyPrefix: ctx.prefix } })
  const run = new Run(() => {
    onErrors.length = 0
  })

  await run.scenario('cold queries with Redis unreachable are served from MongoDB at once', () => fallsThrough(onErrors), 5000)
  await run.scenario(
    'clear() rejects at once with Redis unreachable',
    async () => {
      const started = Date.now()
      const outcome = await instance.clear().then(
        () => 'resolved',
        (err: Error) => err.name,
      )
      const elapsed = Date.now() - started
      assert.notEqual(outcome, 'resolved', 'clear() resolved with Redis unreachable')
      assert.ok(elapsed < FAIL_FAST_MS, `clear() took ${elapsed} ms, expected under ${FAIL_FAST_MS} ms`)
      return { outcome }
    },
    5000,
  )
  await run.scenario(
    'caching starts when Redis comes up',
    async () => {
      await proxy.restore()
      return resumes()
    },
    15_000,
  )
  await run.scenario(
    'queries are served from MongoDB at once when the Redis connection is lost',
    async () => {
      await proxy.drop()
      await sleep(100)
      return fallsThrough(onErrors)
    },
    5000,
  )
  await run.scenario(
    'caching resumes when Redis is back',
    async () => {
      await proxy.restore()
      return resumes()
    },
    15_000,
  )

  await instance.close()
  await proxy.drop()
  return run.results
}
