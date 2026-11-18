import { describe, expect, expectTypeOf, it } from 'vitest'

import * as root from '../src/index'
import * as nest from '../src/nest/index'

import type { CacheData, CacheEngine, CacheOptions, Duration } from '../src/index'
import type { CacheModuleAsyncOptions, CacheModuleOptions, CacheOptionsFactory } from '../src/nest/index'

// The documented public API. A change here is a change to what users depend on: adding is a minor,
// removing or narrowing is a major (see the README and the release notes).
describe('public API', () => {
  it('the root entry exports only the default class at runtime', () => {
    expect(Object.keys(root).sort()).toEqual(['default'])
  })

  it('the default class exposes init statically and clear and close on instances', () => {
    const statics = Object.getOwnPropertyNames(root.default).filter((name) => !['length', 'name', 'prototype'].includes(name))
    expect(statics.sort()).toEqual(['init'])
    const methods = Object.getOwnPropertyNames(root.default.prototype).filter((name) => name !== 'constructor')
    expect(methods.sort()).toEqual(['clear', 'close'])
  })

  it('the nest entry exports the module, the service and the options token at runtime', () => {
    expect(Object.keys(nest).sort()).toEqual(['CACHE_OPTIONS', 'CacheModule', 'CacheService'])
  })

  it('CacheOptions has exactly the documented options', () => {
    expectTypeOf<keyof CacheOptions>().toEqualTypeOf<'engine' | 'engineOptions' | 'defaultTTL' | 'debug' | 'onError' | 'maxEntries' | 'maxBytes' | 'sizeCalculation' | 'coalesce'>()
    expectTypeOf<CacheOptions['engine']>().toEqualTypeOf<'memory' | 'redis'>()
    expectTypeOf<CacheOptions['coalesce']>().toEqualTypeOf<boolean | undefined>()
  })

  it('CacheEngine, CacheData and Duration stay exported types', () => {
    expectTypeOf<keyof CacheEngine>().toEqualTypeOf<'get' | 'set' | 'del' | 'clear' | 'close'>()
    expectTypeOf<undefined>().toExtend<CacheData>()
    expectTypeOf<'1 minute'>().toExtend<Duration>()
  })

  it('the nest option types stay exported', () => {
    expectTypeOf<CacheModuleOptions>().toEqualTypeOf<CacheOptions>()
    expectTypeOf<keyof CacheOptionsFactory>().toEqualTypeOf<'createCacheOptions'>()
    expectTypeOf<keyof CacheModuleAsyncOptions>().toEqualTypeOf<'imports' | 'isGlobal' | 'inject' | 'useClass' | 'useExisting' | 'useFactory'>()
  })
})
