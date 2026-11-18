# ts-cache-mongoose

Cache query and aggregate in mongoose using in-memory or redis

[![npm](https://img.shields.io/npm/v/ts-cache-mongoose)](https://www.npmjs.com/package/ts-cache-mongoose)
[![npm](https://img.shields.io/npm/dt/ts-cache-mongoose)](https://www.npmjs.com/package/ts-cache-mongoose)
[![GitHub](https://img.shields.io/github/license/ilovepixelart/ts-cache-mongoose)](https://github.com/ilovepixelart/ts-cache-mongoose/blob/main/LICENSE)
\
[![Coverage](https://sonarcloud.io/api/project_badges/measure?project=ilovepixelart_ts-cache-mongoose&metric=coverage)](https://sonarcloud.io/summary/new_code?id=ilovepixelart_ts-cache-mongoose)
[![Quality Gate Status](https://sonarcloud.io/api/project_badges/measure?project=ilovepixelart_ts-cache-mongoose&metric=alert_status)](https://sonarcloud.io/summary/new_code?id=ilovepixelart_ts-cache-mongoose)
\
[![Reliability Rating](https://sonarcloud.io/api/project_badges/measure?project=ilovepixelart_ts-cache-mongoose&metric=reliability_rating)](https://sonarcloud.io/summary/new_code?id=ilovepixelart_ts-cache-mongoose)
[![Maintainability Rating](https://sonarcloud.io/api/project_badges/measure?project=ilovepixelart_ts-cache-mongoose&metric=sqale_rating)](https://sonarcloud.io/summary/new_code?id=ilovepixelart_ts-cache-mongoose)
[![Security Rating](https://sonarcloud.io/api/project_badges/measure?project=ilovepixelart_ts-cache-mongoose&metric=security_rating)](https://sonarcloud.io/summary/new_code?id=ilovepixelart_ts-cache-mongoose)
\
[![Socket Badge](https://badge.socket.dev/npm/package/ts-cache-mongoose)](https://socket.dev/npm/package/ts-cache-mongoose)
[![OpenSSF Scorecard](https://api.securityscorecards.dev/projects/github.com/ilovepixelart/ts-cache-mongoose/badge)](https://securityscorecards.dev/viewer/?uri=github.com/ilovepixelart/ts-cache-mongoose)
[![OpenSSF Best Practices](https://www.bestpractices.dev/projects/12484/badge?v=1)](https://www.bestpractices.dev/en/projects/12484)

## Motivation

ts-cache-mongoose is a plugin for mongoose
\
I need a way to cache mongoose queries and aggregations to improve application performance. It should support both in-memory and Redis cache engines, work with all major Node.js frameworks, and be easy to use with a simple `.cache()` method on queries and aggregations.

## Supports and tested with

```json
{
  "node": ">=20",
  "mongoose": ">=6.6.0 <10"
}
```

CI tests on Node.js `22.x` and `24.x` against mongoose `6.12.2`, `7.6.4`, `8.23.0`, and `9.4.1`, and on `26.x` with the mongoose version the lockfile pins.

## Features

- In-memory caching
- Redis caching
- Cache expiration
- Cache invalidation
- Cache key generation
- Cache key prefix
- Query caching
- Aggregate caching
- Supports ESM and CommonJS

## Installation

`mongoose` is a peer dependency: install it alongside `ts-cache-mongoose`.

```bash
npm install ts-cache-mongoose mongoose
pnpm add ts-cache-mongoose mongoose
yarn add ts-cache-mongoose mongoose
bun add ts-cache-mongoose mongoose
```

## Example

Works with any Node.js framework: Express, Fastify, Koa, Hono, etc:

```typescript
import mongoose from 'mongoose'
import cache from 'ts-cache-mongoose'

// In-memory
cache.init(mongoose, {
  defaultTTL: '60 seconds',
  engine: 'memory',
})

// Or Redis
cache.init(mongoose, {
  defaultTTL: '60 seconds',
  engine: 'redis',
  engineOptions: {
    host: 'localhost',
    port: 6379,
  },
})

mongoose.connect('mongodb://localhost:27017/my-database')
```

### Query caching

```typescript
const users = await User.find({ role: 'user' }).cache('10 seconds').exec()
const book = await Book.findById(id).cache('1 hour').exec()
const count = await Book.countDocuments().cache('1 minute').exec()
const authors = await Book.distinct('author').cache('30 seconds').exec()
```

A non-lean `find` or `findOne` is cached as document data and rebuilt on a hit as documents of the query's model (or discriminator), with the query's projection, so defaults apply only to selected paths, and with populated paths as populated documents. Query middleware (`pre('find')`, `post('find')`) runs only when the query reaches MongoDB; `init` hooks run on every hit. A result that a hit cannot rebuild exactly is not cached and every call reaches MongoDB: virtual populate, `refPath` or `ref` functions, populate with `options.lean`, a populated array filtered by `match` or `perDocumentLimit`, a reference to a deleted document, a document changed by a `post('find')` hook, and a document whose `_id` mongoose generates on load.

The in-memory engine keeps its own copy of each result and returns a fresh copy on every hit, so changing a returned result (lean or non-lean, aggregate result or distinct list) does not change what later queries get.

### Aggregate caching

```typescript
const books = await Book.aggregate([
  { $match: { genre: 'fantasy' } },
  { $group: { _id: '$author', count: { $sum: 1 } } },
]).cache('1 minute').exec()
```

### Bounded in-memory cache

The in-memory engine is unbounded by default. For workloads where query keys are driven by user input (search, filters, pagination), cap the cache so a caller generating unique cache keys cannot grow the map without limit. Two bounds are available and can be combined. Eviction is LRU, and whichever bound is hit first triggers it:

```typescript
cache.init(mongoose, {
  engine: 'memory',
  defaultTTL: '60 seconds',
  maxEntries: 10_000,          // cap by entry count
  maxBytes: 50 * 1024 * 1024,  // cap by serialized bytes (50 MB)
})
```

`maxBytes` measures entry size via `node:v8.serialize(value).byteLength` by default: a single C++ call per `set`, on Node / Bun / Deno. A value it cannot serialize (a non-lean mongoose 7+ document, whose arrays are proxies, or a value nested too deep) is sized by a walk over its data instead, so sizing never stops a result from being cached. Without `maxBytes` the default sizer does not run. Provide your own `sizeCalculation` callback if you want an O(1) estimate instead; it runs on every `set`, with or without `maxBytes`:

```typescript
cache.init(mongoose, {
  engine: 'memory',
  maxBytes: 50 * 1024 * 1024,
  sizeCalculation: (value) => {
    if (Array.isArray(value)) return value.length * 512
    return 512
  },
})
```

Eviction is soft: the just-written entry is never dropped, even if its own size exceeds `maxBytes`. Everything older gets evicted until both bounds are satisfied (or only the new entry remains).

Expired entries are removed when their key is read, and every `set` also examines a few entries (continuing where the previous `set` stopped) and removes the expired ones, so entries for keys that are never read again do not accumulate. There are no timers.

Both options are ignored for the Redis engine; use Redis's own `maxmemory` + `maxmemory-policy` instead.

### Custom error handling

By default, cache engine failures (Redis disconnects, serialization errors, etc.) are logged via `console.error` and the query falls through to the database. Pass an `onError` callback to route them somewhere else, e.g. a structured logger, Sentry, or a metric counter:

```typescript
cache.init(mongoose, {
  engine: 'redis',
  defaultTTL: '60 seconds',
  engineOptions: { host: 'localhost', port: 6379 },
  onError: (error) => {
    logger.warn({ err: error }, 'cache engine failure')
  },
})
```

The callback receives the raw `Error`. Cache reads and writes never throw: a failing engine degrades to a cache miss.

### Redis unavailable

When the Redis connection is down (Redis stopped, host unreachable, connection lost), a cache read or write fails at once: `onError` receives the error and the query goes to MongoDB. ioredis keeps reconnecting with its `retryStrategy`, and caching resumes when Redis is back, without a restart. `clear()` rejects at once in the same situation. Commands issued while the first connection is still being established wait for it, for at most one second, so a query sent right after `init()` is still served from Redis.

This comes from two ioredis defaults the engine sets: `enableOfflineQueue: false` and `maxRetriesPerRequest: 0`. A value set in `engineOptions` is used as given. To have commands wait in the ioredis offline queue through reconnection attempts instead (the behaviour before 2.5.0, where a cold query against a stopped Redis took 40 seconds or more), set the ioredis defaults back:

```typescript
engineOptions: { host: 'localhost', port: 6379, enableOfflineQueue: true, maxRetriesPerRequest: 20 }
```

A Redis that accepts connections but stops answering (paused, or a network path that drops packets) is not detected by the connection state; set ioredis `commandTimeout` (milliseconds) to bound how long a cache command waits for it.

### Cache invalidation

```typescript
const instance = cache.init(mongoose, { engine: 'memory', defaultTTL: '60 seconds' })

// Clear all cache
await instance.clear()

// Or use custom cache key
const user = await User.findById(id).cache('1 minute', 'user-key').exec()
await instance.clear('user-key')
```

With the Redis engine, `clear()` deletes only the keys under `engineOptions.keyPrefix` (default `cache-mongoose:`), so the cache can share a Redis database with other data. With `keyPrefix: ''` it deletes every key in the database.

### Cache keys

Without a custom key, the key is a hash of the query (or pipeline) and the data it reads: the model, its collection, database and deployment (first host and port of the connection), and the options that change the result. The same query on another database, for example through `useDb()` or a second connection, never shares an entry. A custom key is used as given, so it must be unique across databases itself.

A query or aggregate that runs in a session bypasses the cache: it is neither read from nor written to it. This covers an explicit `.session(session)` and the implicit session of `connection.transaction()` with `transactionAsyncLocalStorage` enabled, so reads inside a transaction are never cached: the transaction can still abort, and it must see its own writes.

### NestJS (because it's special)

Import `CacheModule` from `ts-cache-mongoose/nest`:

```typescript
import { CacheModule } from 'ts-cache-mongoose/nest'

@Module({
  imports: [
    MongooseModule.forRoot(process.env.MONGO_URI),
    CacheModule.forRoot({
      engine: 'memory',
      defaultTTL: '60 seconds',
    }),
  ],
})
export class AppModule {}
```

With `ConfigService`:

```typescript
CacheModule.forRootAsync({
  inject: [ConfigService],
  useFactory: (config: ConfigService) => ({
    engine: config.get('CACHE_ENGINE', 'memory'),
    defaultTTL: config.get('CACHE_TTL', '60 seconds'),
  }),
})
```

Inject `CacheService` for programmatic cache clearing:

```typescript
import { CacheService } from 'ts-cache-mongoose/nest'

@Injectable()
export class SomeService {
  constructor(private readonly cacheService: CacheService) {}

  async clearUserCache() {
    await this.cacheService.clear('user-cache-key')
  }
}
```

## Contributing

Check [CONTRIBUTING.md](CONTRIBUTING.md)

## License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details

## Check my other projects

- [ts-migrate-mongoose](https://github.com/ilovepixelart/ts-migrate-mongoose) - Migration framework for mongoose
- [ts-patch-mongoose](https://github.com/ilovepixelart/ts-patch-mongoose) - Patch history & events plugin for mongoose
