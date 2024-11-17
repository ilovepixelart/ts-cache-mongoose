import { model, models } from 'mongoose'
import StorySchema from '../schemas/StorySchema'

import type { Model } from 'mongoose'
import type IStory from '../interfaces/IStory'

const Story = (models.Story as Model<IStory> | undefined) || model<IStory>('Story', StorySchema)

export default Story
