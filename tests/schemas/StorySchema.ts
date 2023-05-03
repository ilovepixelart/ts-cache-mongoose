import { Schema } from 'mongoose'

import type IStory from '../interfaces/IStory'

const UserSchema = new Schema<IStory>({
  userId: {
    type: Schema.Types.ObjectId,
    ref: 'User',
    required: true,
    index: true
  },
  title: {
    type: String,
    required: true
  }
}, { timestamps: true })

export default UserSchema
