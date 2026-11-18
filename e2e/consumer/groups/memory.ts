import assert from 'node:assert/strict'
import mongoose from 'mongoose'
import { Run, reads, sleep } from '../harness.ts'
import { models } from '../models.ts'
import { queries } from './queries.ts'

import type { CacheOptions } from '../../../src/index.ts'
import type { Context, Result } from '../harness.ts'

// The memory engine and every option it reads: maxEntries, maxBytes, sizeCalculation, coalesce,
// debug, defaultTTL, and the default onError.

const start = async (ctx: Context, options: CacheOptions) => {
  const cache = await ctx.loaders.load()
  const onErrors: Error[] = []
  const instance = cache.init(mongoose, { onError: (err) => onErrors.push(err), ...options })
  const run = new Run(async () => {
    await instance.clear()
    onErrors.length = 0
  })
  return { cache, instance, onErrors, run }
}

const byGenre = (genre: string) => models(mongoose.connection).Book.find({ genre }).lean().cache()

// Round trips for each query, in order: 0 for a hit, 1 for a miss.
const roundTripsOf = async (queries: (() => PromiseLike<unknown>)[]): Promise<number[]> => {
  const trips: number[] = []
  for (const query of queries) {
    const before = reads.count
    await query()
    trips.push(reads.count - before)
  }
  return trips
}

export const memory = async (ctx: Context): Promise<Result[]> => {
  const { instance, onErrors, run } = await start(ctx, { engine: 'memory', defaultTTL: '1 minute' })
  await queries({ ctx, run, instance, onErrors })
  await run.scenario('close() resolves and later queries still return MongoDB data', async () => {
    await instance.close()
    const rows = await byGenre('scifi')
    assert.equal(rows.length, 1)
    return { rows: rows.length }
  })
  return run.results
}

export const memoryMaxEntries = async (ctx: Context): Promise<Result[]> => {
  const { run } = await start(ctx, { engine: 'memory', defaultTTL: '1 second', maxEntries: 2 })
  await run.scenario('maxEntries evicts the least recently used entry', async () => {
    const trips = await roundTripsOf([() => byGenre('a'), () => byGenre('b'), () => byGenre('a'), () => byGenre('c'), () => byGenre('a'), () => byGenre('b')])
    assert.deepEqual(trips, [1, 1, 0, 1, 0, 1], 'expected b (least recently used) to be evicted when c was added')
    return trips
  })
  await run.scenario('defaultTTL applies to a query cached without a TTL', async () => {
    const trips = await roundTripsOf([() => byGenre('a'), () => byGenre('a'), () => sleep(1600), () => byGenre('a')])
    assert.deepEqual(trips, [1, 0, 0, 1], 'expected the entry to expire after the 1 second defaultTTL')
    return trips
  })
  return run.results
}

export const memoryMaxBytes = async (ctx: Context): Promise<Result[]> => {
  const { onErrors, run } = await start(ctx, { engine: 'memory', defaultTTL: '1 minute', maxBytes: 1 })
  await run.scenario('maxBytes keeps only the newest entry when each entry exceeds it', async () => {
    const trips = await roundTripsOf([() => byGenre('fantasy'), () => byGenre('scifi'), () => byGenre('scifi'), () => byGenre('fantasy')])
    assert.deepEqual(trips, [1, 1, 0, 1])
    return trips
  })
  await run.scenario('maxBytes sizes non-lean documents with arrays without an engine error', async () => {
    const { Book } = models(mongoose.connection)
    const trips = await roundTripsOf([() => Book.find({}).sort({ title: 1 }).cache(), () => Book.find({}).sort({ title: 1 }).cache()])
    assert.deepEqual(trips, [1, 0])
    assert.equal(onErrors.length, 0, `onError was called: ${onErrors[0]?.message}`)
    return trips
  })
  return run.results
}

export const memorySizeCalculation = async (ctx: Context): Promise<Result[]> => {
  const sized: string[] = []
  const sizeCalculation = (value: unknown) => {
    const rows = value as { genre?: string }[]
    if (Array.isArray(rows) && rows[0]?.genre === 'scifi') throw new Error('size refused')
    sized.push(Array.isArray(value) ? 'array' : typeof value)
    return 100
  }
  const { onErrors, run } = await start(ctx, { engine: 'memory', defaultTTL: '1 minute', maxBytes: 250, sizeCalculation })
  await run.scenario('sizeCalculation sizes every entry and maxBytes evicts by its sizes', async () => {
    sized.length = 0
    const trips = await roundTripsOf([() => byGenre('a'), () => byGenre('b'), () => byGenre('a'), () => byGenre('c'), () => byGenre('a'), () => byGenre('b')])
    assert.deepEqual(trips, [1, 1, 0, 1, 0, 1], 'expected two entries of size 100 to fit in 250 bytes')
    return { trips, sized }
  })
  await run.scenario('an engine failure goes to onError and the query is served from MongoDB', async () => {
    const results = [await byGenre('scifi'), await byGenre('scifi')]
    assert.deepEqual(
      results.map((rows) => rows.length),
      [1, 1],
    )
    assert.equal(reads.count, 2, 'a result whose write failed was served from the cache')
    assert.deepEqual(
      onErrors.map((err) => err.message),
      ['size refused', 'size refused'],
    )
    return { roundTrips: reads.count, errors: onErrors.map((err) => err.message) }
  })
  return run.results
}

export const memoryCoalesceOff = async (ctx: Context): Promise<Result[]> => {
  const { run } = await start(ctx, { engine: 'memory', defaultTTL: '1 minute', coalesce: false })
  await run.scenario('with coalesce: false every concurrent cold caller runs its own query', async () => {
    await Promise.all(Array.from({ length: 10 }, () => byGenre('fantasy')))
    const concurrent = reads.count
    await byGenre('fantasy')
    assert.deepEqual([concurrent, reads.count], [10, 10], 'expected 10 round trips for 10 concurrent callers, then a hit')
    return { concurrent, afterHit: reads.count }
  })
  // Also records whether the failure reaches process 'unhandledRejection', which ends a Node
  // process by default even though the caller handled the rejection.
  await run.scenario('with coalesce: false a failing cached query rejects for its caller', async () => {
    const unhandled: unknown[] = []
    const listener = (reason: unknown) => unhandled.push(reason)
    process.on('unhandledRejection', listener)
    try {
      const code = await models(mongoose.connection)
        .Book.find({ $expr: { $nope: 1 } })
        .lean()
        .cache()
        .then(
          () => 'fulfilled',
          (err: { code?: unknown }) => err.code,
        )
      await sleep(100)
      assert.equal(code, 168)
      return { code, unhandledRejection: unhandled.length > 0 }
    } finally {
      process.off('unhandledRejection', listener)
    }
  })
  return run.results
}

const KEY = /\b[0-9a-f]{40}\b/g

// Captures what the cache prints with console.log and console.error.
const capture = () => {
  const lines: string[] = []
  const { log } = console
  console.log = (...args: unknown[]) => {
    const line = args.map(String).join(' ')
    if (line.startsWith('[ts-cache-mongoose]')) lines.push(line.replace(KEY, '<key>'))
    else log(...args)
  }
  console.error = (...args: unknown[]) => {
    lines.push(`console.error: ${args.map((arg) => (arg instanceof Error ? arg.message : String(arg))).join(' ')}`)
  }
  return lines
}

export const memoryDebug = async (ctx: Context): Promise<Result[]> => {
  const lines = capture()
  const cache = await ctx.loaders.load()
  const sizeCalculation = (value: unknown) => {
    if ((value as { genre?: string }[])[0]?.genre === 'scifi') throw new Error('size refused')
    return 1
  }
  const instance = cache.init(mongoose, { engine: 'memory', debug: true, defaultTTL: '45 seconds', sizeCalculation })
  const run = new Run(() => {
    lines.length = 0
  })
  await run.scenario('debug logs a miss, a write with the defaultTTL and a hit', async () => {
    await byGenre('fantasy')
    await byGenre('fantasy')
    assert.deepEqual(lines, ["[ts-cache-mongoose] GET '<key>' - MISS", "[ts-cache-mongoose] SET '<key>' - ttl: 45000 ms", "[ts-cache-mongoose] GET '<key>' - HIT"])
    return [...lines]
  })
  await run.scenario('debug logs a skipped write for a TTL of 0', async () => {
    await models(mongoose.connection).Book.find({ genre: 'none' }).lean().cache(0)
    assert.deepEqual(lines, ["[ts-cache-mongoose] GET '<key>' - MISS", "[ts-cache-mongoose] SET '<key>' - skipped (non-positive ttl: 0 ms)"])
    return [...lines]
  })
  await run.scenario('debug logs clear(key) and clear()', async () => {
    await instance.clear('some-key')
    await instance.clear()
    assert.deepEqual(lines, ["[ts-cache-mongoose] DEL 'some-key'", '[ts-cache-mongoose] CLEAR'])
    return [...lines]
  })
  await run.scenario('without onError an engine failure is logged with console.error', async () => {
    const rows = await byGenre('scifi')
    assert.equal(rows.length, 1)
    assert.deepEqual(lines, ["[ts-cache-mongoose] GET '<key>' - MISS", 'console.error: size refused'])
    return [...lines]
  })
  return run.results
}
