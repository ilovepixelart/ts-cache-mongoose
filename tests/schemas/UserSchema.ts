import { Schema } from 'mongoose'

import type IUser from '../interfaces/IUser'

const UserSchema = new Schema<IUser>({
  name: {
    type: String,
    required: true
  },
  role: {
    type: String,
    required: true
  },
  age: {
    type: Number
  }
}, { timestamps: true })

UserSchema.virtual('stories', {
  ref: 'Story',
  localField: '_id',
  foreignField: 'userId'
})

export default UserSchema
