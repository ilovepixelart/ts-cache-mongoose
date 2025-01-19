import { model, models, Schema } from 'mongoose'

import type { HydratedDocument, Model, Types } from 'mongoose'
import type { Story } from './Story'

export interface User {
  _id: Types.ObjectId
  name: string
  role: string
  age?: number
  createdAt?: Date
  updatedAt?: Date
  stories?: HydratedDocument<Story>[]
}

export const UserSchema = new Schema<User>(
  {
    name: {
      type: String,
      required: true,
    },
    role: {
      type: String,
      required: true,
    },
    age: {
      type: Number,
    },
  },
  { timestamps: true },
)

UserSchema.virtual('stories', {
  ref: 'Story',
  localField: '_id',
  foreignField: 'userId',
})

export const UserModel = (models.User as Model<User> | undefined) ?? model<User>('User', UserSchema)
