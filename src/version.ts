import { satisfies } from 'semver'
import mongoose from 'mongoose'

export const isMongooseLessThan7 = satisfies(mongoose.version, '<7')

export const convertToObject = (value: unknown): unknown => {
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
