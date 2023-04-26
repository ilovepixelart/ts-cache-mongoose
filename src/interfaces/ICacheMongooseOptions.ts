interface ICacheMongooseOptions {
  engine: 'memory' | 'redis'
  defaultTTL?: string
  port?: number
  host?: string
  password?: string,
  client?: unknown,
}

export default ICacheMongooseOptions
