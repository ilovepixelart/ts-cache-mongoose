import type { RedisOptions } from 'ioredis'
import type { StringValue } from 'ms'

interface ICacheOptions {
  engine: 'memory' | 'redis'
  engineOptions?: RedisOptions
  defaultTTL?: number | StringValue
  debug?: boolean
}

export default ICacheOptions
