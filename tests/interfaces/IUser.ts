import type { HydratedDocument, Types } from 'mongoose'
import type IStory from './IStory'

interface IUser {
  _id: Types.ObjectId
  name: string
  role: string
  age?: number
  createdAt?: Date
  updatedAt?: Date
  stories?: HydratedDocument<IStory>[]
}

export default IUser
