import 'reflect-metadata'

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { Test } from '@nestjs/testing'
import { CacheModule } from '../src/nest/cache.module'
import { CacheService } from '../src/nest/cache.service'

import type { CacheOptions } from '../src/types'

const initMock = vi.fn()

vi.mock('../src/index', () => ({
  default: {
    init: (...args: unknown[]) => {
      initMock(...args)
      return {
        clear: vi.fn().mockResolvedValue(undefined),
        close: vi.fn().mockResolvedValue(undefined),
      }
    },
  },
}))

const defaultOptions = { engine: 'memory', defaultTTL: '60 seconds' } satisfies CacheOptions

describe('CacheModule — real Nest DI', () => {
  beforeEach(() => {
    initMock.mockReset()
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('forRoot wires CacheService through the real DI container', async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [CacheModule.forRoot(defaultOptions)],
    }).compile()

    const svc = moduleRef.get(CacheService)
    expect(svc).toBeInstanceOf(CacheService)

    await moduleRef.init()
    expect(initMock).toHaveBeenCalledTimes(1)

    await moduleRef.close()
  })

  it('forRootAsync resolves a sync useFactory through the real DI container', async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [CacheModule.forRootAsync({ useFactory: () => defaultOptions })],
    }).compile()

    await moduleRef.init()
    expect(initMock).toHaveBeenCalledTimes(1)

    await moduleRef.close()
  })

  it('forRootAsync resolves an async useFactory through the real DI container', async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [
        CacheModule.forRootAsync({
          useFactory: async () => {
            await Promise.resolve()
            return defaultOptions
          },
        }),
      ],
    }).compile()

    await moduleRef.init()
    expect(initMock).toHaveBeenCalledTimes(1)

    await moduleRef.close()
  })

  it('forRootAsync useClass calls createCacheOptions via the real container', async () => {
    const createSpy = vi.fn().mockReturnValue(defaultOptions)

    class TestFactory {
      createCacheOptions() {
        return createSpy()
      }
    }

    const moduleRef = await Test.createTestingModule({
      imports: [CacheModule.forRootAsync({ useClass: TestFactory })],
    }).compile()

    await moduleRef.init()
    expect(createSpy).toHaveBeenCalledTimes(1)
    expect(initMock).toHaveBeenCalledWith(expect.anything(), defaultOptions)

    await moduleRef.close()
  })

  it('onApplicationShutdown closes the cache via enableShutdownHooks', async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [CacheModule.forRoot(defaultOptions)],
    }).compile()
    moduleRef.enableShutdownHooks()

    await moduleRef.init()
    const svc = moduleRef.get(CacheService)
    const closeSpy = vi.spyOn(svc.instance, 'close')
    await moduleRef.close()

    expect(closeSpy).toHaveBeenCalled()
  })
})
