import { satisfies } from 'semver'
import mongoose from 'mongoose'

import type IData from './interfaces/IData'

export const isMongooseLessThan7 = satisfies(mongoose.version, '<7')

export const convertToObject = <T>(value: T & { toObject?: () => IData } | undefined): IData => {
  if (isMongooseLessThan7) {
    if (value != null && typeof value === 'object' && !Array.isArray(value) && value.toObject) {
      // eslint-disable-next-line @typescript-eslint/no-unsafe-call
      return value.toObject()
    }
    if (Array.isArray(value)) {
      return value.map((doc) => convertToObject(doc))
    }
  }

  return value
}
