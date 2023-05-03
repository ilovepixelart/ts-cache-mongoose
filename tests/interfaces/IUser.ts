import type { HydratedDocument } from 'mongoose'
import type IStory from './IStory'

interface IUser {
  name: string
  role: string
  age?: number
  createdAt?: Date
  updatedAt?: Date
  stories?: HydratedDocument<IStory>[]
}

export default IUser
