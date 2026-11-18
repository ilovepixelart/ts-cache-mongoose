import 'reflect-metadata'
import assert from 'node:assert/strict'
import { Module } from '@nestjs/common'
import { NestFactory } from '@nestjs/core'
import IORedis from 'ioredis'
import mongoose from 'mongoose'
import { Run, reads } from '../harness.ts'
import { models } from '../models.ts'

import type { DynamicModule, INestApplicationContext } from '@nestjs/common'
import type { CacheModuleOptions } from '../../../src/nest/index.ts'
import type { Context, NestLibrary, Result } from '../harness.ts'

// ts-cache-mongoose/nest in a Nest application context: CacheModule.forRoot and every
// forRootAsync form, CacheService injected into another module, and shutdown closing the cache.

const PROBE = 'PROBE'
const CONFIG = 'CONFIG'

const moduleClass = (name: string, metadata: Parameters<typeof Module>[0]) => {
  const target = { [name]: class {} }[name] as new () => object
  Module(metadata)(target)
  return target
}

const application = (nest: NestLibrary, cacheModule: DynamicModule): Promise<INestApplicationContext> => {
  const feature = moduleClass('FeatureModule', { providers: [{ provide: PROBE, useFactory: (service: unknown) => service, inject: [nest.CacheService] }], exports: [PROBE] })
  const app = moduleClass('AppModule', { imports: [cacheModule, feature] })
  return NestFactory.createApplicationContext(app, { logger: false })
}

const scenarios = async (ctx: Context, run: Run, app: INestApplicationContext, nest: NestLibrary): Promise<void> => {
  const cache = await ctx.loaders.load()
  const service = app.get(nest.CacheService)
  const { Book } = models(mongoose.connection)

  await run.scenario('CacheService is injected into another module through isGlobal', async () => {
    assert.equal(app.get(PROBE), service)
    return true
  })
  await run.scenario('bootstrap initializes the instance the root entry returns', async () => {
    assert.ok(service.instance instanceof cache, 'CacheService.instance is not an instance of the root entry class')
    assert.equal(cache.init(mongoose, { engine: 'memory' }), service.instance, 'init() returned another instance than the one Nest created')
    return true
  })
  await run.scenario('queries are cached after bootstrap', async () => {
    for (let call = 0; call < 3; call++) await Book.find({ genre: 'fantasy' }).lean().cache()
    assert.equal(reads.count, 1)
    return { roundTrips: reads.count }
  })
  await run.scenario('CacheService.clear(key) and clear() invalidate', async () => {
    const query = () => Book.find({ genre: 'scifi' }).lean().cache('1 minute', 'nest-key')
    await query()
    await query()
    await service.clear('nest-key')
    await query()
    await service.clear()
    await query()
    assert.equal(reads.count, 3, `expected 3 round trips (miss, after clear(key), after clear()), got ${reads.count}`)
    return { roundTrips: reads.count }
  })
}

const withRedisClientName = async (ctx: Context, name: string, fn: (connected: () => Promise<boolean>) => Promise<void>) => {
  const client = new IORedis({ ...ctx.redis, lazyConnect: true })
  await client.connect()
  try {
    await fn(async () => String(await client.client('LIST')).includes(`name=${name} `))
  } finally {
    client.disconnect()
  }
}

const shutdown = async (ctx: Context, run: Run, app: INestApplicationContext, clientName: string): Promise<void> => {
  await withRedisClientName(ctx, clientName, async (connected) => {
    await run.scenario('application shutdown closes the cache engine', async () => {
      const before = await connected()
      await app.close()
      const after = await connected()
      assert.deepEqual({ before, after }, { before: true, after: false }, 'the Redis connection of the cache is still open after app.close()')
      return { before, after }
    })
  })
}

const redisOptions = (ctx: Context, clientName: string): CacheModuleOptions => ({
  engine: 'redis',
  defaultTTL: '1 minute',
  engineOptions: { ...ctx.redis, keyPrefix: ctx.prefix, connectionName: clientName },
})

type Variant = (nest: NestLibrary, options: CacheModuleOptions) => DynamicModule

const nestGroup =
  (variant: Variant) =>
  async (ctx: Context): Promise<Result[]> => {
    const nest = await ctx.loaders.loadNest()
    const clientName = `${ctx.prefix.slice(0, -1)}-nest`
    const app = await application(nest, variant(nest, redisOptions(ctx, clientName)))
    const run = new Run(() => app.get(nest.CacheService).clear())
    await scenarios(ctx, run, app, nest)
    await shutdown(ctx, run, app, clientName)
    return run.results
  }

export const nestForRoot = nestGroup((nest, options) => nest.CacheModule.forRoot({ ...options, isGlobal: true }))

export const nestForRootAsyncFactory = nestGroup((nest, options) => {
  const config = moduleClass('ConfigModule', { providers: [{ provide: CONFIG, useValue: options }], exports: [CONFIG] })
  return nest.CacheModule.forRootAsync({ isGlobal: true, imports: [config], inject: [CONFIG], useFactory: (value: CacheModuleOptions) => value })
})

export const nestForRootAsyncClass = nestGroup((nest, options) => {
  class Factory {
    createCacheOptions(): Promise<CacheModuleOptions> {
      return Promise.resolve(options)
    }
  }
  return nest.CacheModule.forRootAsync({ isGlobal: true, useClass: Factory })
})

export const nestForRootAsyncExisting = nestGroup((nest, options) => {
  class Factory {
    createCacheOptions(): CacheModuleOptions {
      return options
    }
  }
  const config = moduleClass('ConfigModule', { providers: [Factory], exports: [Factory] })
  return nest.CacheModule.forRootAsync({ isGlobal: true, imports: [config], useExisting: Factory })
})
