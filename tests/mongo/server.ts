import fs from 'node:fs'
import mongoose from 'mongoose'

import { MongoMemoryServer } from 'mongodb-memory-server'

const server = (dbName: string) => {
  let mongo: MongoMemoryServer
  const dbPath = `./tests/mongo/${dbName}`

  const create = async () => {
    fs.mkdirSync(dbPath, { recursive: true })
    mongo = await MongoMemoryServer.create({
      instance: {
        dbName,
        dbPath,
      },
    })

    const uri = mongo.getUri()
    await mongoose.connect(uri)
  }

  const destroy = async () => {
    await mongoose.connection.dropDatabase()
    await mongoose.connection.close()
    await mongo.stop({ doCleanup: true, force: true })
  }

  return { create, destroy }
}

export default server
