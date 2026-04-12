import { describe, expect, it, vi } from 'vitest'

import { CacheModule } from '../src/nest/cache.module'
import { CACHE_OPTIONS, CacheService } from '../src/nest/cache.service'

import type { CacheOptions } from '../src/types'

vi.mock('@nestjs/common', () => {
  const LoggerMock = class {
    log = vi.fn()
  }
  return {
    Module: () => () => {},
    Logger: LoggerMock,
  }
})

vi.mock('../src/index', () => ({
  default: {
    init: vi.fn().mockReturnValue({
      clear: vi.fn(),
      close: vi.fn(),
    }),
  },
}))

const defaultOptions = { engine: 'memory', defaultTTL: '60 seconds' } satisfies CacheOptions

describe('CacheModule', () => {
  describe('forRoot', () => {
    it('should return a dynamic module with providers', () => {
      const result = CacheModule.forRoot(defaultOptions)
      expect(result.module).toBe(CacheModule)
      expect(result.providers).toBeDefined()
      expect(result.exports).toContain(CacheService)
    })

    it('should set global to false by default', () => {
      const result = CacheModule.forRoot(defaultOptions)
      expect(result.global).toBe(false)
    })

    it('should set global when isGlobal is true', () => {
      const result = CacheModule.forRoot({ ...defaultOptions, isGlobal: true })
      expect(result.global).toBe(true)
    })

    it('should provide CACHE_OPTIONS with useValue', () => {
      const result = CacheModule.forRoot(defaultOptions)
      const optionsProvider = (result.providers as { provide: symbol; useValue: unknown }[]).find((p) => p.provide === CACHE_OPTIONS)
      expect(optionsProvider).toBeDefined()
      expect(optionsProvider?.useValue).toEqual(defaultOptions)
    })
  })

  describe('forRootAsync', () => {
    it('should return a dynamic module with useFactory', () => {
      const result = CacheModule.forRootAsync({
        useFactory: () => defaultOptions,
      })
      expect(result.module).toBe(CacheModule)
      expect(result.providers).toBeDefined()
      expect(result.exports).toContain(CacheService)
    })

    it('should support useClass', () => {
      class TestFactory {
        createCacheOptions() {
          return defaultOptions
        }
      }
      const result = CacheModule.forRootAsync({ useClass: TestFactory })
      expect(result.providers).toBeDefined()
      expect(result.providers?.length).toBeGreaterThan(1)
    })

    it('should support useExisting', () => {
      class TestFactory {
        createCacheOptions() {
          return defaultOptions
        }
      }
      const result = CacheModule.forRootAsync({ useExisting: TestFactory })
      expect(result.providers).toBeDefined()
    })

    it('should return empty providers when no factory method', () => {
      const result = CacheModule.forRootAsync({})
      const providers = result.providers as unknown[]
      const serviceProvider = providers.find((p) => typeof p === 'object' && p !== null && 'provide' in p && (p as { provide: unknown }).provide === CacheService)
      expect(serviceProvider).toBeDefined()
    })

    it('should pass imports through', () => {
      const result = CacheModule.forRootAsync({
        imports: [],
        useFactory: () => defaultOptions,
      })
      expect(result.imports).toEqual([])
    })

    it('should set global when isGlobal is true', () => {
      const result = CacheModule.forRootAsync({
        isGlobal: true,
        useFactory: () => defaultOptions,
      })
      expect(result.global).toBe(true)
    })
  })
})

describe('CacheService', () => {
  it('should store options', () => {
    const service = new CacheService(defaultOptions)
    expect(service).toBeDefined()
  })

  it('should initialize cache on bootstrap', async () => {
    const service = new CacheService(defaultOptions)
    await service.onApplicationBootstrap()
    expect(service.instance).toBeDefined()
  })

  it('should close cache on shutdown', async () => {
    const service = new CacheService(defaultOptions)
    await service.onApplicationBootstrap()
    const closeSpy = vi.spyOn(service.instance, 'close')
    await service.onApplicationShutdown()
    expect(closeSpy).toHaveBeenCalled()
  })

  it('should not throw on shutdown when not initialized', async () => {
    const service = new CacheService(defaultOptions)
    await expect(service.onApplicationShutdown()).resolves.not.toThrow()
  })

  it('should clear cache with custom key', async () => {
    const service = new CacheService(defaultOptions)
    await service.onApplicationBootstrap()
    const clearSpy = vi.spyOn(service.instance, 'clear')
    await service.clear('test-key')
    expect(clearSpy).toHaveBeenCalledWith('test-key')
  })

  it('should clear all cache without key', async () => {
    const service = new CacheService(defaultOptions)
    await service.onApplicationBootstrap()
    const clearSpy = vi.spyOn(service.instance, 'clear')
    await service.clear()
    expect(clearSpy).toHaveBeenCalledWith(undefined)
  })

  it('should expose instance getter', async () => {
    const service = new CacheService(defaultOptions)
    await service.onApplicationBootstrap()
    expect(service.instance).toBeDefined()
    expect(service.instance.clear).toBeDefined()
    expect(service.instance.close).toBeDefined()
  })
})
