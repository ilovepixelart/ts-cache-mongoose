/** biome-ignore-all lint/complexity/noStaticOnlyClass: nest */
import { Module } from '@nestjs/common'
import { CACHE_OPTIONS, CacheService } from './cache.service'

import type { DynamicModule, Provider } from '@nestjs/common'
import type { CacheModuleAsyncOptions, CacheModuleOptions, CacheOptionsFactory } from './interfaces'

@Module({})
export class CacheModule {
  static forRoot(options: CacheModuleOptions & { isGlobal?: boolean }): DynamicModule {
    return {
      module: CacheModule,
      global: options.isGlobal ?? false,
      providers: [
        { provide: CACHE_OPTIONS, useValue: options },
        {
          provide: CacheService,
          useFactory: (opts: CacheModuleOptions) => new CacheService(opts),
          inject: [CACHE_OPTIONS],
        },
      ],
      exports: [CacheService],
    }
  }

  static forRootAsync(options: CacheModuleAsyncOptions): DynamicModule {
    const asyncProviders = CacheModule.createAsyncProviders(options)

    return {
      module: CacheModule,
      global: options.isGlobal ?? false,
      imports: options.imports ?? [],
      providers: [
        ...asyncProviders,
        {
          provide: CacheService,
          useFactory: (opts: CacheModuleOptions) => new CacheService(opts),
          inject: [CACHE_OPTIONS],
        },
      ],
      exports: [CacheService],
    }
  }

  private static createAsyncProviders(options: CacheModuleAsyncOptions): Provider[] {
    if (options.useFactory) {
      return [
        {
          provide: CACHE_OPTIONS,
          useFactory: options.useFactory,
          inject: options.inject ?? [],
        },
      ]
    }

    if (options.useClass) {
      return [
        { provide: options.useClass, useClass: options.useClass },
        {
          provide: CACHE_OPTIONS,
          useFactory: (factory: CacheOptionsFactory) => factory.createCacheOptions(),
          inject: [options.useClass],
        },
      ]
    }

    if (options.useExisting) {
      return [
        {
          provide: CACHE_OPTIONS,
          useFactory: (factory: CacheOptionsFactory) => factory.createCacheOptions(),
          inject: [options.useExisting],
        },
      ]
    }

    return []
  }
}
