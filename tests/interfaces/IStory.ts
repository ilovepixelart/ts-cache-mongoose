import type { Types } from 'mongoose'

interface IStory {
  _id: Types.ObjectId
  userId: Types.ObjectId
  title: string
  createdAt: Date
  updatedAt: Date
}

export default IStory
