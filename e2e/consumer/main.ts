import { writeFileSync } from 'node:fs'
import mongoose from 'mongoose'
import { memoryFuzz, redisFuzz } from './groups/fuzz.ts'
import { exportsGroup, initInvalidEngine, initRedisWithoutOptions } from './groups/init.ts'
import { memory, memoryCoalesceOff, memoryDebug, memoryMaxBytes, memoryMaxEntries, memorySizeCalculation } from './groups/memory.ts'
import { nestForRoot, nestForRootAsyncClass, nestForRootAsyncExisting, nestForRootAsyncFactory } from './groups/nest.ts'
import { redis, redisDown } from './groups/redis.ts'
import { monitor } from './harness.ts'
import { seed } from './models.ts'

import type { Context, Loaders, Result } from './harness.ts'

// One scenario group per process: init() configures the cache once per process.
export const groups: Record<string, (ctx: Context) => Promise<Result[]>> = {
  exports: exportsGroup,
  'init-invalid-engine': initInvalidEngine,
  'init-redis-without-options': initRedisWithoutOptions,
  memory,
  'memory-max-entries': memoryMaxEntries,
  'memory-max-bytes': memoryMaxBytes,
  'memory-size-calculation': memorySizeCalculation,
  'memory-coalesce-off': memoryCoalesceOff,
  'memory-debug': memoryDebug,
  'memory-fuzz': memoryFuzz,
  redis,
  'redis-down': redisDown,
  'redis-fuzz': redisFuzz,
  'nest-for-root': nestForRoot,
  'nest-for-root-async-factory': nestForRootAsyncFactory,
  'nest-for-root-async-class': nestForRootAsyncClass,
  'nest-for-root-async-existing': nestForRootAsyncExisting,
}

const required = (name: string): string => {
  const value = process.env[name]
  if (!value) throw new Error(`${name} is not set`)
  return value
}

export const main = async (loaders: Loaders): Promise<void> => {
  const group = required('E2E_GROUP')
  const run = groups[group]
  if (!run) throw new Error(`Unknown scenario group: ${group}`)
  const ctx: Context = {
    loaders,
    uri: required('E2E_MONGO_URI'),
    db: required('E2E_DB'),
    redis: { host: required('E2E_REDIS_HOST'), port: Number(required('E2E_REDIS_PORT')) },
    prefix: `${required('E2E_DB')}:`,
  }
  await mongoose.connect(ctx.uri, { dbName: ctx.db, monitorCommands: true })
  monitor(mongoose.connection)
  await mongoose.connection.dropDatabase()
  await seed(mongoose.connection)
  const results = await run(ctx)
  writeFileSync(required('E2E_OUT'), JSON.stringify({ group, version: mongoose.version, results }, null, 2))
  await mongoose.connection.dropDatabase()
  await mongoose.disconnect()
  // Queries a stalled cache left pending must not keep the process alive.
  process.exit(0)
}
