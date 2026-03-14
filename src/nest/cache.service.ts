import { Logger } from '@nestjs/common'
import mongoose from 'mongoose'
import CacheMongoose from '../index'

import type { OnApplicationBootstrap, OnApplicationShutdown } from '@nestjs/common'
import type { CacheModuleOptions } from './interfaces'

export const CACHE_OPTIONS = Symbol('CACHE_OPTIONS')

export class CacheService implements OnApplicationBootstrap, OnApplicationShutdown {
  private readonly logger = new Logger(CacheService.name)
  private readonly options: CacheModuleOptions
  private cacheMongoose!: CacheMongoose

  constructor(options: CacheModuleOptions) {
    this.options = options
  }

  get instance(): CacheMongoose {
    return this.cacheMongoose
  }

  async onApplicationBootstrap(): Promise<void> {
    this.cacheMongoose = CacheMongoose.init(mongoose, this.options)
    this.logger.log(`Cache initialized with ${this.options.engine} engine`)
  }

  async onApplicationShutdown(): Promise<void> {
    if (this.cacheMongoose) {
      await this.cacheMongoose.close()
    }
  }

  async clear(customKey?: string): Promise<void> {
    await this.cacheMongoose.clear(customKey)
  }
}
