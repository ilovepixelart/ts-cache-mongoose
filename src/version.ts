import mongoose from 'mongoose'
import { satisfies } from 'semver'

import type IData from './interfaces/IData'

export const isMongooseLessThan7 = satisfies(mongoose.version, '<7')

export const convertToObject = <T>(value: (T & { toObject?: () => IData }) | undefined): IData => {
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
