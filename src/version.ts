import mongoose from 'mongoose'

import type { CacheData } from './types'

export const isMongooseLessThan7 = Number.parseInt(mongoose.version, 10) < 7

export const convertToObject = <T>(value: (T & { toObject?: () => CacheData }) | undefined): CacheData => {
  if (isMongooseLessThan7) {
    if (value != null && typeof value === 'object' && !Array.isArray(value) && value.toObject) {
      return value.toObject()
    }
    if (Array.isArray(value)) {
      return value.map((doc) => convertToObject(doc))
    }
  }

  return value
}
