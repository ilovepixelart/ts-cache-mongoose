import type { Types } from 'mongoose'

interface IStory {
  userId: Types.ObjectId
  title: string
}

export default IStory
