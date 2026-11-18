import { describeCoalescing } from './coalesce/coalesce'

// Writes and clears cache keys, so it runs only against a Redis named explicitly through REDIS_PORT.
const redisPort = process.env.REDIS_PORT

describeCoalescing('redis', () => {
  if (!redisPort) return undefined
  return { engine: 'redis', engineOptions: { host: process.env.REDIS_HOST ?? 'localhost', port: Number(redisPort), keyPrefix: 'coalesce:' } }
})
