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

[![npm](https://nodei.co/npm/ts-cache-mongoose.png)](https://www.npmjs.com/package/ts-cache-mongoose)

## Motivation

ts-cache-mongoose is a plugin for mongoose
\
Caching queries is a good way to improve performance of your application
\
⚠️ This is initial prerelease of the plugin
\
🛠️ Work in progress...

## Features

- [x] In-memory caching
- [x] Redis caching
- [x] Cache expiration
- [x] Cache invalidation
- [x] Cache key generation
- [x] Cache key prefix
- [x] Query caching support
- [x] Aggregate caching support
- [ ] More tests

## Installation

```bash
npm install ts-cache-mongoose
yard add ts-cache-mongoose
```

- This plugin requires mongoose `>=6.6.x || 7.x` to be installed as a peer dependency

```bash
# For mongoose 6
npm install mongoose@legacy
yarn add mongoose mongoose@legacy
# For mongoose 7
npm install mongoose@latest
yarn add mongoose@latest
```

## Usage

```typescript
// On your application startup
import mongoose from 'mongoose'
import cache from 'ts-cache-mongoose'

// In memory example 
const cache = cache.init(mongoose, {
  engine: 'memory',
})

// Redis example
const cache = cache.init(mongoose, {
  engine: 'redis',
  engineOptions: {
    host: 'localhost',
    port: 6379,
  },
})

mongoose.connect('mongodb://localhost:27017/my-database')

// Somewhere in your code
const users = await User.find({ role: 'user' }).cache('1 minute').exec()
const book = await Book.findById(id).cache('30 seconds').exec()
```
