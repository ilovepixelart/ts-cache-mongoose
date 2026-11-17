import { afterEach, describe, expect, it, vi } from 'vitest'

import { Cache } from '../src/cache/Cache'

describe('debug log of cached falsy values', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('logs a cached null and 0 as hits and a missing key as a miss', async () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => undefined)
    const cache = new Cache({ engine: 'memory', debug: true })
    await cache.set('null-key', null as unknown as undefined, '1 minute')
    await cache.set('zero-key', 0, '1 minute')
    log.mockClear()
    await cache.get('null-key')
    await cache.get('zero-key')
    await cache.get('missing-key')
    expect(log.mock.calls.map(([line]) => line)).toEqual(["[ts-cache-mongoose] GET 'null-key' - HIT", "[ts-cache-mongoose] GET 'zero-key' - HIT", "[ts-cache-mongoose] GET 'missing-key' - MISS"])
  })
})
