import assert from 'node:assert/strict'
import mongoose from 'mongoose'
import { observe, Run, reads } from '../harness.ts'
import { models, oid, seed } from '../models.ts'

import type { CacheOptions } from '../../../src/index.ts'
import type { Context, Result } from '../harness.ts'
import type { Cacheable } from './queries.ts'

// Seeded random queries over two databases in one cache: the miss and the hit of every query equal
// MongoDB's uncached result, and the hit costs no round trip. Interleaving many query shapes in one
// cache is what exposes one query's entry being served for another.

const QUERIES = 150
const SEED = 20_261_118

const random = (seed: number) => {
  let state = seed
  const next = () => {
    state = (state * 1_103_515_245 + 12_345) % 2_147_483_648
    return state / 2_147_483_648
  }
  return <T>(items: readonly T[]): T => items[Math.floor(next() * items.length)] as T
}

const FILTERS = [{}, { genre: 'fantasy' }, { genre: 'none' }, { pages: { $gt: 200 } }, { tags: 'space' }, { author: oid(1) }, { title: { $regex: '^(other )?[AB]' } }, { published: { $gte: new Date('2020-01-01T00:00:00Z') } }, { $or: [{ pages: { $lt: 150 } }, { tags: 'magic' }] }, { 'publisher.city': 'Oslo' }]
const SORTS: (Record<string, 1 | -1> | null)[] = [null, { title: 1 }, { pages: -1 }, { genre: 1, title: -1 }]
const PROJECTIONS = [null, 'title pages', '-reviews -attrs', { title: 1, _id: 0 }, { tags: 1 }]
const OPS = ['find', 'find', 'findOne', 'countDocuments', 'distinct', 'aggregate'] as const
const LIMITS = [0, 0, 1, 2]

type Op = (typeof OPS)[number]
type Draw = { db: string; op: Op; filter: Record<string, unknown>; sort: Record<string, 1 | -1> | null; projection: string | Record<string, number> | null; lean: boolean; limit: number; field: string }

const build = (connection: mongoose.Connection, draw: Draw): Cacheable => {
  const { Book } = models(connection)
  if (draw.op === 'aggregate') return Book.aggregate([{ $match: draw.filter }, { $sort: draw.sort ?? { _id: 1 } }, { $project: { title: 1, pages: 1 } }])
  if (draw.op === 'countDocuments') return Book.countDocuments(draw.filter)
  if (draw.op === 'distinct') return Book.distinct(draw.field, draw.filter)
  const query = draw.op === 'find' ? Book.find(draw.filter) : Book.findOne(draw.filter)
  if (draw.sort) query.sort(draw.sort)
  if (draw.projection) query.select(draw.projection)
  if (draw.op === 'find' && draw.limit) query.limit(draw.limit)
  return draw.lean ? query.lean() : query
}

const fuzz =
  (engineOptions: (ctx: Context) => CacheOptions) =>
  async (ctx: Context): Promise<Result[]> => {
    const cache = await ctx.loaders.load()
    const onErrors: Error[] = []
    cache.init(mongoose, { ...engineOptions(ctx), onError: (err) => onErrors.push(err) })
    const other = mongoose.connection.useDb(`${ctx.db}_other`)
    await seed(other, 'other ')
    const connections: Record<string, mongoose.Connection> = { main: mongoose.connection, other }
    const pick = random(SEED)
    const run = new Run()
    await run.scenario(
      `${QUERIES} seeded random queries: miss and hit equal MongoDB, hit without a round trip`,
      async () => {
        const failures: string[] = []
        for (let i = 0; i < QUERIES; i++) {
          // Every draw happens on every iteration, so that a change in one query never shifts the next.
          const draw: Draw = { db: pick(['main', 'other']), op: pick(OPS), filter: pick(FILTERS), sort: pick(SORTS), projection: pick(PROJECTIONS), lean: pick([true, false]), limit: pick(LIMITS), field: pick(['genre', 'pages', 'tags']) }
          const connection = connections[draw.db] as mongoose.Connection
          const truth = JSON.stringify(observe(await build(connection, draw)))
          const miss = JSON.stringify(observe(await build(connection, draw).cache()))
          const before = reads.count
          const hit = JSON.stringify(observe(await build(connection, draw).cache()))
          const problems = [miss === truth ? '' : 'miss differs', hit === truth ? '' : 'hit differs', reads.count === before ? '' : 'hit reached MongoDB'].filter(Boolean)
          if (problems.length > 0) failures.push(`#${i} ${JSON.stringify(draw)}: ${problems.join(', ')}`)
        }
        await other.dropDatabase()
        assert.deepEqual(failures, [], `${failures.length} of ${QUERIES} queries failed`)
        assert.equal(onErrors.length, 0, `onError was called: ${onErrors[0]?.message}`)
        return { queries: QUERIES, failures: failures.length }
      },
      60_000,
    )
    return run.results
  }

export const memoryFuzz = fuzz(() => ({ engine: 'memory', defaultTTL: '10 minutes' }))

export const redisFuzz = fuzz((ctx) => ({ engine: 'redis', defaultTTL: '10 minutes', engineOptions: { ...ctx.redis, keyPrefix: ctx.prefix } }))
