import assert from 'node:assert/strict'
import mongoose from 'mongoose'
import { mongooseMajor, mongooseMinor, monitor, observe, reads, sleep } from '../harness.ts'
import { models, oid, seed } from '../models.ts'

import type { Duration } from '../../../src/index.ts'
import type { Context, Library, Run } from '../harness.ts'

// The scenarios every engine has to pass: each read operation lean and non-lean, document shapes,
// populate, projections, BSON value types, TTL, custom keys and clear(), other connections and
// databases, sessions and transactions, concurrent cold queries and query errors. The uncached
// result is the oracle, and MongoDB read commands are counted, because a query that is silently
// never cached still returns correct data.

export type Cacheable = PromiseLike<unknown> & { cache: (ttl?: Duration, key?: string) => PromiseLike<unknown> }

export type Suite = {
  ctx: Context
  run: Run
  instance: ReturnType<Library['init']>
  onErrors: Error[]
}

const CALLS = 3

const noEngineErrors = (onErrors: Error[]): void => {
  assert.equal(onErrors.length, 0, `onError was called: ${onErrors.map((err) => err.message).join('; ')}`)
}

// N cached calls equal the uncached result and cost the round trips of one uncached call.
const servedFromCache = async (suite: Suite, build: () => Cacheable, roundTrips: number): Promise<unknown> => {
  const truth = observe(await build())
  reads.count = 0
  for (let call = 1; call <= CALLS; call++) {
    assert.deepEqual(observe(await build().cache()), truth, `cached call ${call} differs from the uncached result`)
  }
  assert.equal(reads.count, roundTrips, `expected ${roundTrips} MongoDB round trip(s) for ${CALLS} identical cached calls, got ${reads.count}`)
  noEngineErrors(suite.onErrors)
  return { roundTrips: reads.count, result: truth }
}

const readOperations = (): [string, () => Cacheable, number][] => {
  const { Book } = models(mongoose.connection)
  const fantasy = { genre: 'fantasy' }
  return [
    ['find, lean', () => Book.find(fantasy).sort({ title: 1 }).lean(), 1],
    ['find, documents', () => Book.find(fantasy).sort({ title: 1 }), 1],
    ['findOne, lean', () => Book.findOne({ title: 'Alpha' }).lean(), 1],
    ['findOne, document', () => Book.findOne({ title: 'Alpha' }), 1],
    ['findOne without a match', () => Book.findOne({ title: 'none' }), 1],
    ['findById, document', () => Book.findById(oid(13)), 1],
    ['find with populate, documents', () => Book.find({}).sort({ title: 1 }).populate('author'), 2],
    ['find with populate, lean', () => Book.find({}).sort({ title: 1 }).populate('author').lean(), 2],
    ['find with an inclusive projection, documents', () => Book.find({}).sort({ title: 1 }).select('title tags'), 1],
    ['find with an exclusive projection, documents', () => Book.find({}).sort({ title: 1 }).select('-reviews -attrs'), 1],
    ['find with an object projection without _id, lean', () => Book.find({}).sort({ title: 1 }).select({ title: 1, _id: 0 }).lean(), 1],
    ['find selecting a select:false path, documents', () => Book.find({}).sort({ title: 1 }).select('+secret'), 1],
    ['find with skip and limit, documents', () => Book.find({}).sort({ pages: -1 }).skip(1).limit(1), 1],
    ['countDocuments', () => Book.countDocuments(fantasy), 1],
    ['countDocuments without a match', () => Book.countDocuments({ genre: 'none' }), 1],
    ['estimatedDocumentCount', () => Book.estimatedDocumentCount(), 1],
    ['distinct', () => Book.distinct('genre'), 1],
    ['aggregate', () => Book.aggregate([{ $group: { _id: '$genre', n: { $sum: 1 }, pages: { $sum: '$pages' } } }, { $sort: { _id: 1 } }]), 1],
    ['aggregate with $lookup', () => Book.aggregate([{ $sort: { title: 1 } }, { $lookup: { from: 'authors', localField: 'author', foreignField: '_id', as: 'by' } }]), 1],
  ]
}

const scenariosForReads = async (suite: Suite): Promise<void> => {
  for (const [name, build, roundTrips] of readOperations()) {
    await suite.run.scenario(`${name}: cached calls equal the uncached result in one round trip`, () => servedFromCache(suite, build, roundTrips))
  }
}

const BSON_PATHS = ['_id', 'author', 'price', 'cover', 'published', 'attrs', 'isbn']

const valueAt = (result: unknown, path: string): unknown => {
  if (result instanceof mongoose.Document) return result.get(path)
  return (result as Record<string, unknown>)[path]
}

const scenariosForTypes = async (suite: Suite): Promise<void> => {
  const { Book } = models(mongoose.connection)
  for (const lean of [true, false]) {
    await suite.run.scenario(`BSON values on a hit are instances of the uncached classes (${lean ? 'lean' : 'documents'})`, async () => {
      const build = () => (lean ? Book.findOne({ _id: oid(11) }).lean() : Book.findOne({ _id: oid(11) }))
      const truth = await build()
      await build().cache()
      const hit = await build().cache()
      const classes: Record<string, string> = {}
      for (const path of BSON_PATHS) {
        const expected = valueAt(truth, path)
        const actual = valueAt(hit, path)
        if (expected == null) continue
        // A getter can return a primitive (a UUID path is a string on mongoose 6 and 7 documents).
        if (typeof expected !== 'object') {
          assert.equal(typeof actual, typeof expected, `${path}: expected a ${typeof expected}, got ${typeof actual}`)
          classes[path] = typeof expected
          continue
        }
        const expectedClass = (expected as object).constructor
        assert.ok(actual instanceof expectedClass, `${path}: expected an instance of ${expectedClass.name}, got ${(actual as object | null)?.constructor?.name ?? String(actual)}`)
        assert.equal((actual as object).constructor, expectedClass, `${path}: ${(actual as object).constructor.name} is not the uncached ${expectedClass.name}`)
        classes[path] = expectedClass.name
      }
      assert.ok(valueAt(hit, '_id') instanceof mongoose.Types.ObjectId, '_id on a hit is not a mongoose.Types.ObjectId')
      assert.equal(reads.count, 2, `expected 2 round trips (uncached call and miss), got ${reads.count}`)
      noEngineErrors(suite.onErrors)
      return classes
    })
  }
}

const titles = (rows: unknown): string[] => (rows as { title: string }[]).map((row) => row.title)

const scenariosForTtlAndKeys = async (suite: Suite): Promise<void> => {
  const { Book } = models(mongoose.connection)
  const fantasy = () => Book.find({ genre: 'fantasy' }).sort({ title: 1 }).lean()
  const scifi = () => Book.find({ genre: 'scifi' }).sort({ title: 1 }).lean()

  await suite.run.scenario('an entry expires after its TTL', async () => {
    await fantasy().cache('1 second')
    await fantasy().cache('1 second')
    const beforeExpiry = reads.count
    await sleep(1600)
    await fantasy().cache('1 second')
    assert.deepEqual([beforeExpiry, reads.count], [1, 2], 'expected 1 round trip before expiry and a second after it')
    return { beforeExpiry, afterExpiry: reads.count }
  })

  for (const ttl of [0, '-1 second'] as Duration[]) {
    await suite.run.scenario(`a TTL of ${String(ttl)} caches nothing`, async () => {
      for (let call = 0; call < CALLS; call++) await fantasy().cache(ttl)
      assert.equal(reads.count, CALLS, `expected every call to reach MongoDB, got ${reads.count} round trips for ${CALLS} calls`)
      return { roundTrips: reads.count }
    })
  }

  await suite.run.scenario('a hit is served until clear(key) removes its custom key, and other entries stay', async () => {
    await fantasy().cache('1 minute', 'e2e-fantasy')
    await scifi().cache()
    await Book.updateOne({ title: 'Alpha' }, { title: 'Alpha 2' })
    const stale = titles(await fantasy().cache('1 minute', 'e2e-fantasy'))
    await suite.instance.clear('e2e-fantasy')
    const fresh = titles(await fantasy().cache('1 minute', 'e2e-fantasy'))
    await scifi().cache()
    await Book.updateOne({ title: 'Alpha 2' }, { title: 'Alpha' })
    assert.deepEqual(stale, ['Alpha', 'Beta'], 'the cached result was not served before clear(key)')
    assert.deepEqual(fresh, ['Alpha 2', 'Beta'], 'clear(key) did not remove the entry')
    assert.equal(reads.count, 3, `expected 3 round trips (two misses and one after clear(key)), got ${reads.count}`)
    return { stale, fresh, roundTrips: reads.count }
  })

  await suite.run.scenario('clear() removes every entry', async () => {
    await fantasy().cache()
    await scifi().cache('1 minute', 'e2e-scifi')
    await suite.instance.clear()
    await fantasy().cache()
    await scifi().cache('1 minute', 'e2e-scifi')
    assert.equal(reads.count, 4, `expected 4 round trips (2 misses before and 2 after clear()), got ${reads.count}`)
    return { roundTrips: reads.count }
  })

  await suite.run.scenario('two queries with the same custom key share one entry', async () => {
    const first = titles(await fantasy().cache('1 minute', 'e2e-shared'))
    const second = titles(await scifi().cache('1 minute', 'e2e-shared'))
    assert.deepEqual(second, first, 'the second query did not get the entry of the first')
    assert.equal(reads.count, 1)
    return { first, second }
  })

  await suite.run.scenario('the same query on another database through useDb() has its own entry', async () => {
    const other = mongoose.connection.useDb(`${suite.ctx.db}_other`)
    await seed(other, 'other ')
    reads.count = 0
    const query = (connection: mongoose.Connection) => models(connection).Book.find({ genre: 'fantasy' }).sort({ title: 1 }).lean().cache()
    const results = [titles(await query(mongoose.connection)), titles(await query(other)), titles(await query(mongoose.connection)), titles(await query(other))]
    await other.dropDatabase()
    assert.deepEqual(results, [
      ['Alpha', 'Beta'],
      ['other Alpha', 'other Beta'],
      ['Alpha', 'Beta'],
      ['other Alpha', 'other Beta'],
    ])
    assert.equal(reads.count, 2, `expected one round trip per database, got ${reads.count}`)
    return results
  })

  await suite.run.scenario('a model of a createConnection() connection is cached', async () => {
    const connection = await mongoose.createConnection(suite.ctx.uri, { dbName: suite.ctx.db, monitorCommands: true }).asPromise()
    monitor(connection)
    try {
      const build = () => models(connection).Book.find({ genre: 'scifi' }).lean()
      return await servedFromCache(suite, build, 1)
    } finally {
      await connection.close()
    }
  })
}

const scenariosForSessions = async (suite: Suite): Promise<void> => {
  const { Book } = models(mongoose.connection)
  const scifi = () => Book.find({ genre: 'scifi' }).lean()

  await suite.run.scenario('a query in an explicit session bypasses the cache', async () => {
    const session = await mongoose.startSession()
    try {
      await scifi().cache().session(session)
      await scifi().cache().session(session)
      const inSession = reads.count
      await scifi().cache()
      await scifi().cache()
      assert.deepEqual([inSession, reads.count], [2, 3], 'expected 2 round trips in the session, then 1 for the first call without it')
      return { inSession, total: reads.count }
    } finally {
      await session.endSession()
    }
  })

  await suite.run.scenario('a read inside an aborted transaction is never served later', async () => {
    const inTransaction = await mongoose.connection
      .transaction(async (session) => {
        await Book.create([{ title: 'Uncommitted', genre: 'tx' }], { session })
        const rows = await Book.find({ genre: 'tx' }).lean().cache().session(session)
        throw Object.assign(new Error('abort'), { rows: titles(rows) })
      })
      .catch((err: { rows?: string[] }) => err.rows)
    const after = titles(await Book.find({ genre: 'tx' }).lean().cache())
    assert.deepEqual(inTransaction, ['Uncommitted'])
    assert.deepEqual(after, [], 'a result read inside the aborted transaction was served')
    return { inTransaction, after }
  })

  const implicit = mongooseMajor > 8 || (mongooseMajor === 8 && mongooseMinor >= 4)
  await suite.run.scenario('a read in a transaction with transactionAsyncLocalStorage bypasses the cache', async () => {
    if (!implicit) return 'not applicable: transactionAsyncLocalStorage needs mongoose 8.4 or later'
    mongoose.set('transactionAsyncLocalStorage' as never, true as never)
    try {
      const inTransaction = await mongoose.connection
        .transaction(async () => {
          await Book.create([{ title: 'Implicit', genre: 'tx' }])
          const rows = await Book.find({ genre: 'tx' }).lean().cache()
          throw Object.assign(new Error('abort'), { rows: titles(rows) })
        })
        .catch((err: { rows?: string[] }) => err.rows)
      const after = titles(await Book.find({ genre: 'tx' }).lean().cache())
      assert.deepEqual(inTransaction, ['Implicit'])
      assert.deepEqual(after, [], 'a result read inside the aborted transaction was served')
      return { inTransaction, after }
    } finally {
      mongoose.set('transactionAsyncLocalStorage' as never, false as never)
    }
  })
}

const CONCURRENT = 30

const scenariosForConcurrency = async (suite: Suite): Promise<void> => {
  const { Book } = models(mongoose.connection)
  const cases: [string, () => Cacheable][] = [
    ['find, lean', () => Book.find({}).sort({ title: 1 }).lean()],
    ['find, documents', () => Book.find({}).sort({ title: 1 })],
    ['aggregate', () => Book.aggregate([{ $sort: { title: 1 } }, { $project: { title: 1, tags: 1 } }])],
    ['distinct', () => Book.distinct('genre')],
    ['countDocuments', () => Book.countDocuments({})],
  ]
  for (const [name, build] of cases) {
    await suite.run.scenario(`${CONCURRENT} concurrent identical cold queries (${name}) share one round trip`, async () => {
      const truth = observe(await build())
      reads.count = 0
      const results = await Promise.all(Array.from({ length: CONCURRENT }, () => build().cache()))
      for (const result of results) assert.deepEqual(observe(result), truth, 'a concurrent caller got a result that differs from the uncached result')
      assert.equal(reads.count, 1, `expected 1 MongoDB round trip for ${CONCURRENT} concurrent callers, got ${reads.count}`)
      if (typeof results[0] === 'object') assert.equal(new Set(results).size, CONCURRENT, 'concurrent callers share result objects')
      noEngineErrors(suite.onErrors)
      return { roundTrips: reads.count }
    })
  }

  await suite.run.scenario('a concurrent caller changing its documents does not change the others', async () => {
    const results = (await Promise.all(Array.from({ length: CONCURRENT }, () => Book.find({}).sort({ title: 1 }).cache()))) as unknown as (mongoose.Document & { title: string; tags: string[] })[][]
    const [mine, ...others] = results
    const doc = mine?.[0]
    assert.ok(doc instanceof Book, 'a concurrent caller did not get Book documents')
    doc.title = 'mutated'
    doc.tags.push('mutated')
    for (const docs of others) assert.deepEqual([docs[0]?.title, [...(docs[0]?.tags ?? [])]], ['Alpha', ['magic', 'quest']])
    const next = (await Book.find({}).sort({ title: 1 }).cache()) as unknown as { title: string }[]
    assert.equal(next[0]?.title, 'Alpha', 'a hit after the change carries the change')
    return { roundTrips: reads.count }
  })

  await suite.run.scenario('concurrent queries with different keys do not share', async () => {
    const results = await Promise.all(
      Array.from({ length: CONCURRENT }, (_, i) =>
        Book.find({ genre: i % 2 ? 'scifi' : 'fantasy' })
          .lean()
          .cache(),
      ),
    )
    for (const [i, rows] of results.entries()) assert.equal(rows.length, i % 2 ? 1 : 2)
    assert.equal(reads.count, 2, `expected one round trip per key, got ${reads.count}`)
    return { roundTrips: reads.count }
  })
}

const rejection = async (promise: PromiseLike<unknown>): Promise<{ name: string; code: unknown }> => {
  try {
    await promise
  } catch (err) {
    return { name: (err as Error).name, code: (err as { code?: unknown }).code }
  }
  throw new Error('expected the query to reject')
}

const scenariosForErrors = async (suite: Suite): Promise<void> => {
  const { Book } = models(mongoose.connection)
  await suite.run.scenario('a failing cached query rejects with the MongoDB error every time and is not cached', async () => {
    const errors = [
      await rejection(Book.aggregate([{ $nope: {} } as never]).cache()),
      await rejection(Book.aggregate([{ $nope: {} } as never]).cache()),
      await rejection(
        Book.find({ $expr: { $nope: 1 } })
          .lean()
          .cache(),
      ),
      await rejection(
        Book.find({ $expr: { $nope: 1 } })
          .lean()
          .cache(),
      ),
    ]
    for (const error of errors) assert.equal(error.name, 'MongoServerError')
    assert.deepEqual(
      errors.map((error) => error.code),
      [40324, 40324, 168, 168],
    )
    assert.equal(reads.count, 4, `expected every failing call to reach MongoDB, got ${reads.count} round trips`)
    noEngineErrors(suite.onErrors)
    return errors
  })

  await suite.run.scenario('concurrent callers of a failing query all reject with its error', async () => {
    const outcomes = await Promise.allSettled(
      Array.from({ length: 5 }, () =>
        Book.find({ $expr: { $nope: 1 } })
          .lean()
          .cache(),
      ),
    )
    const codes = outcomes.map((outcome) => (outcome.status === 'rejected' ? (outcome.reason as { code?: unknown }).code : 'fulfilled'))
    assert.deepEqual(codes, [168, 168, 168, 168, 168])
    return { codes }
  })
}

const scenariosForCopies = async (suite: Suite): Promise<void> => {
  const { Book } = models(mongoose.connection)
  await suite.run.scenario('changing a returned result does not change later hits', async () => {
    const [row] = (await Book.find({ genre: 'fantasy' }).sort({ title: 1 }).lean().cache()) as unknown as { title: string; tags: string[] }[]
    assert.ok(row)
    row.title = 'changed'
    row.tags.push('changed')
    const [doc] = (await Book.find({ genre: 'fantasy' }).sort({ title: 1 }).cache()) as unknown as { title: string }[]
    assert.ok(doc)
    doc.title = 'changed'
    const leanAgain = (await Book.find({ genre: 'fantasy' }).sort({ title: 1 }).lean().cache()) as unknown as { title: string; tags: string[] }[]
    const docsAgain = (await Book.find({ genre: 'fantasy' }).sort({ title: 1 }).cache()) as unknown as { title: string }[]
    const observed = { lean: [leanAgain[0]?.title, leanAgain[0]?.tags], documents: docsAgain[0]?.title, roundTrips: reads.count }
    assert.deepEqual(observed, { lean: ['Alpha', ['magic', 'quest']], documents: 'Alpha', roundTrips: 2 })
    return observed
  })
}

export const queries = async (suite: Suite): Promise<void> => {
  await scenariosForReads(suite)
  await scenariosForTypes(suite)
  await scenariosForTtlAndKeys(suite)
  await scenariosForSessions(suite)
  await scenariosForConcurrency(suite)
  await scenariosForErrors(suite)
  await scenariosForCopies(suite)
}
