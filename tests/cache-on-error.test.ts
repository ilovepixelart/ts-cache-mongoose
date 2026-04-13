import { beforeEach, describe, expect, it, vi } from 'vitest'

const getMock = vi.fn()
const setexMock = vi.fn()
const delMock = vi.fn()
const flushdbMock = vi.fn()
const quitMock = vi.fn()

vi.mock('ioredis', () => {
  class FakeRedis {
    get = getMock
    setex = setexMock
    del = delMock
    flushdb = flushdbMock
    quit = quitMock
  }
  return { default: FakeRedis }
})

const { Cache } = await import('../src/cache/Cache')
const { RedisCacheEngine } = await import('../src/cache/engine/RedisCacheEngine')

describe('onError callback', () => {
  beforeEach(() => {
    getMock.mockReset()
    setexMock.mockReset()
    delMock.mockReset()
    flushdbMock.mockReset()
    quitMock.mockReset()
  })

  it('Cache#onError defaults to console.error', () => {
    const cache = new Cache({ engine: 'memory' })
    expect(cache.onError).toBe(console.error)
  })

  it('Cache#onError returns the user-supplied callback', () => {
    const onError = vi.fn()
    const cache = new Cache({ engine: 'memory', onError })
    expect(cache.onError).toBe(onError)
  })

  it('Cache wires onError into RedisCacheEngine so get() failures are forwarded', async () => {
    const onError = vi.fn()
    const cache = new Cache({
      engine: 'redis',
      engineOptions: { host: '127.0.0.1', port: 6379 },
      onError,
    })
    const boom = new Error('get failed')
    getMock.mockRejectedValueOnce(boom)
    const result = await cache.get('missing')
    expect(result).toBeUndefined()
    expect(onError).toHaveBeenCalledWith(boom)
  })

  it('RedisCacheEngine forwards set() failures to the supplied callback', async () => {
    const onError = vi.fn()
    const engine = new RedisCacheEngine({ host: '127.0.0.1', port: 6379 }, onError)
    const boom = new Error('setex failed')
    setexMock.mockRejectedValueOnce(boom)
    await engine.set('k', { a: 1 }, '1 minute')
    expect(onError).toHaveBeenCalledWith(boom)
  })

  it('RedisCacheEngine.set() skips the write and does not call onError when the value converts to undefined', async () => {
    const onError = vi.fn()
    const engine = new RedisCacheEngine({ host: '127.0.0.1', port: 6379 }, onError)
    await engine.set('k', undefined, '1 minute')
    expect(setexMock).not.toHaveBeenCalled()
    expect(onError).not.toHaveBeenCalled()
  })
})
