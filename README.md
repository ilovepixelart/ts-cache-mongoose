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
  "node": "18.x || 20.x || 22.x",
  "mongoose": ">=6.6.x || 7.x || 8.x",
}
```

## Features

- [x] In-memory caching
- [x] Redis caching
- [x] Cache expiration
- [x] Cache invalidation
- [x] Cache key generation
- [x] Cache key prefix
- [x] Query caching
- [x] Aggregate caching
- [x] Supports ESM and CommonJS

## Installation

- Locally inside your project

```bash
npm install ts-cache-mongoose
pnpm add ts-cache-mongoose
yarn add ts-cache-mongoose
bun add ts-cache-mongoose
```

- This plugin requires mongoose `>=6.6.x || 7.x || 8.x` to be installed as a peer dependency

```bash
# For latest mongoose 6
npm install mongoose@6
pnpm add mongoose@6
yarn add mongoose@6
bun add mongoose@6
# For latest mongoose 7
npm install mongoose@7
pnpm add mongoose@7
yarn add mongoose@7
bun add mongoose@7
# For latest mongoose 8
npm install mongoose@8
pnpm add mongoose@8
yarn add mongoose@8
bun add mongoose@8
```

## Example

```typescript
// On your application startup
import mongoose from 'mongoose'
import cache from 'ts-cache-mongoose'

// In-memory example 
const instance = cache.init(mongoose, {
  defaultTTL: '60 seconds',
  engine: 'memory',
  debug: true, // Debug mode enables hit/miss logs in console, not for production use
})

// OR

// Redis example
const instance = cache.init(mongoose, {
  defaultTTL: '60 seconds',
  engine: 'redis',
  engineOptions: {
    host: 'localhost',
    port: 6379,
  },
  debug: true, // Debug mode enables hit/miss logs in console, not for production use
})

// Connect to your database
mongoose.connect('mongodb://localhost:27017/my-database')

// Somewhere in your code
const users = await User.find({ role: 'user' }).cache('10 seconds').exec()
// Cache hit
const users = await User.find({ role: 'user' }).cache('10 seconds').exec()

const book = await Book.findById(id).cache('1 hour').exec()
const bookCount = await Book.countDocuments().cache('1 minute').exec()
const authors = await Book.distinct('author').cache('30 seconds').exec()

const books = await Book.aggregate([
  {
    $match: {
      genre: 'fantasy',
    },
  },
  {
    $group: {
      _id: '$author',
      count: { $sum: 1 },
    },
  },
  {
    $project: {
      _id: 0,
      author: '$_id',
      count: 1,
    },
  }
]).cache('1 minute').exec()

// Cache invalidation

// To clear all cache, don't use in production unless you know what you are doing
await instance.clear()

// Instead use custom cache key
const user = await User.findById('61bb4d6a1786e5123d7f4cf1').cache('1 minute', 'some-custom-key').exec()
await instance.clear('some-custom-key')
```

## Check my other projects

- [ts-migrate-mongoose](https://github.com/ilovepixelart/ts-migrate-mongoose) - Migration framework for mongoose
- [ts-patch-mongoose](https://github.com/ilovepixelart/ts-patch-mongoose) - Patch history & events plugin for mongoose
