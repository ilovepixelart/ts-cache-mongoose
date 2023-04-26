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
  }
}, { timestamps: true })

export default UserSchema
