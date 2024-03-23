import type { RedisOptions } from 'ioredis'

interface ICacheOptions {
  engine: 'memory' | 'redis'
  engineOptions?: RedisOptions
  defaultTTL?: string
  debug?: boolean;
}

export default ICacheOptions
