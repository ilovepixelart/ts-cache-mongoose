import type { ObjectId } from 'mongoose'

interface IStory {
  _id: ObjectId
  userId: ObjectId
  title: string
  createdAt: Date
  updatedAt: Date
}

export default IStory
