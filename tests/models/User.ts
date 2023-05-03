import { model } from 'mongoose'
import UserSchema from '../schemas/UserSchema'

export default model('User', UserSchema)
