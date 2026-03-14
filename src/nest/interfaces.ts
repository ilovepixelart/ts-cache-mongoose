import type { InjectionToken, ModuleMetadata, OptionalFactoryDependency, Type } from '@nestjs/common'
import type { CacheOptions } from '../types'

export type CacheModuleOptions = CacheOptions

export interface CacheOptionsFactory {
  createCacheOptions(): CacheModuleOptions | Promise<CacheModuleOptions>
}

export interface CacheModuleAsyncOptions extends Pick<ModuleMetadata, 'imports'> {
  isGlobal?: boolean
  inject?: (InjectionToken | OptionalFactoryDependency)[]
  useClass?: Type<CacheOptionsFactory>
  useExisting?: Type<CacheOptionsFactory>
  // biome-ignore lint/suspicious/noExplicitAny: NestJS convention for factory args
  useFactory?: (...args: any[]) => CacheModuleOptions | Promise<CacheModuleOptions>
}
