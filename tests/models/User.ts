import { model, models } from 'mongoose'
import UserSchema from '../schemas/UserSchema'

import type { Model } from 'mongoose'
import type IUser from '../interfaces/IUser'

const Story = (models.User as Model<IUser> | undefined) ?? model<IUser>('User', UserSchema)

export default Story
