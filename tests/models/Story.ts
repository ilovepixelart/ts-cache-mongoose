import { model, models, Schema } from 'mongoose'

import type { Model, Types } from 'mongoose'

export interface Story {
  _id: Types.ObjectId
  userId: Types.ObjectId
  title: string
  createdAt: Date
  updatedAt: Date
}

export const StorySchema = new Schema<Story>(
  {
    userId: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true,
    },
    title: {
      type: String,
      required: true,
    },
  },
  { timestamps: true },
)

export const StoryModel = (models.Story as Model<Story> | undefined) ?? model<Story>('Story', StorySchema)
