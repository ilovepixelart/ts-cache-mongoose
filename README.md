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

## Motivation

ts-cache-mongoose is a plugin for mongoose
\
Caching queries is a good way to improve performance of your application

## Supports and tested with

```json
{
  "node": "20.x || 22.x || 24.x",
  "mongoose": ">=6.6.x || 7.x || 8.x || 9.x",
}
```

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

- Locally inside your project

```bash
npm install ts-cache-mongoose
pnpm add ts-cache-mongoose
yarn add ts-cache-mongoose
bun add ts-cache-mongoose
```

- This plugin requires `mongoose` to be installed as a peer dependency

```bash
npm install mongoose
pnpm add mongoose
yarn add mongoose
bun add mongoose
```

## Example

Works with any Node.js framework — Express, Fastify, Koa, Hono, etc:

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

### Aggregate caching

```typescript
const books = await Book.aggregate([
  { $match: { genre: 'fantasy' } },
  { $group: { _id: '$author', count: { $sum: 1 } } },
]).cache('1 minute').exec()
```

### Cache invalidation

```typescript
const instance = cache.init(mongoose, { engine: 'memory', defaultTTL: '60 seconds' })

// Clear all cache
await instance.clear()

// Or use custom cache key
const user = await User.findById(id).cache('1 minute', 'user-key').exec()
await instance.clear('user-key')
```

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

## Check my other projects

- [ts-migrate-mongoose](https://github.com/ilovepixelart/ts-migrate-mongoose) - Migration framework for mongoose
- [ts-patch-mongoose](https://github.com/ilovepixelart/ts-patch-mongoose) - Patch history & events plugin for mongoose
