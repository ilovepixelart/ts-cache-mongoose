import { model, models } from 'mongoose'
import UserSchema from '../schemas/UserSchema'

import type { Model } from 'mongoose'
import type IUser from '../interfaces/IUser'

const Story = (models.Story as Model<IUser> | undefined) || model<IUser>('Story', UserSchema)

export default Story
