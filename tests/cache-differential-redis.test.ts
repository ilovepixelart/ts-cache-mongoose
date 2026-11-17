import { describeDifferential } from './hydrate/differential'

// Writes and clears cache keys, so it runs only against a Redis named explicitly through REDIS_PORT.
const redisPort = process.env.REDIS_PORT

describeDifferential('redis', () => {
  if (!redisPort) return undefined
  return { engine: 'redis', defaultTTL: '10 minutes', engineOptions: { host: process.env.REDIS_HOST ?? 'localhost', port: Number(redisPort), keyPrefix: 'differential:' } }
})
