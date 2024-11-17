import type { Types } from 'mongoose'

interface IStory {
  userId: Types.ObjectId
  title: string
  createdAt: Date
  updatedAt: Date
}

export default IStory
