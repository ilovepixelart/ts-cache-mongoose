import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

import mongoose, { Schema } from 'mongoose'
import CacheMongoose from '../../src/index'
import { server } from '../mongo/server'

import type { CacheOptions } from '../../src/types'

// Results that are null, 0 or empty are results like any other: the repeat of a cached query
// returns them without reaching MongoDB, even after a matching document appears.

const READ_METHODS = new Set(['find', 'findOne', 'aggregate', 'countDocuments', 'estimatedDocumentCount', 'count', 'distinct'])

const Falsy = mongoose.model('FalsyDoc', new Schema({ name: String, n: Number }))

export const describeFalsyResults = (engine: string, options: () => CacheOptions | undefined): void => {
  describe.skipIf(options() === undefined)(`null, 0 and empty results are cached (${engine})`, () => {
    const instance = server(`cache-falsy-${engine}`)
    const onError = vi.fn()
    let reads = 0
    let cache: CacheMongoose

    beforeAll(async () => {
      cache = CacheMongoose.init(mongoose, { ...(options() as CacheOptions), onError })
      await instance.create()
      mongoose.set('debug', (_collection: string, method: string) => {
        if (READ_METHODS.has(method)) reads++
      })
    })

    afterAll(async () => {
      mongoose.set('debug', false)
      await cache.clear()
      await cache.close()
      await instance.destroy()
    })

    beforeEach(async () => {
      onError.mockReset()
      await cache.clear()
      await Falsy.deleteMany({})
      reads = 0
    })

    const cases: [string, () => { exec: () => Promise<unknown> }, unknown][] = [
      ['a findOne that matches nothing', () => Falsy.findOne({ name: 'x' }).cache(), null],
      ['a lean findOne that matches nothing', () => Falsy.findOne({ name: 'x' }).lean().cache(), null],
      ['a findById that matches nothing', () => Falsy.findById(new mongoose.Types.ObjectId('0123456789abcdef01234567')).cache(), null],
      ['a countDocuments of 0', () => Falsy.countDocuments({ name: 'x' }).cache(), 0],
      ['an estimatedDocumentCount of 0', () => Falsy.estimatedDocumentCount().cache(), 0],
      ['an empty distinct', () => Falsy.distinct('name', { name: 'x' }).cache(), []],
      ['an empty find', () => Falsy.find({ name: 'x' }).cache(), []],
      ['an empty aggregate', () => Falsy.aggregate([{ $match: { name: 'x' } }]).cache(), []],
    ]

    it('serves a non-zero estimatedDocumentCount from the cache as a number', async () => {
      await Falsy.create({ name: 'y', n: 2 })
      expect(await Falsy.estimatedDocumentCount().cache()).toBe(1)
      await Falsy.create({ name: 'z', n: 3 })
      expect(await Falsy.estimatedDocumentCount().cache()).toBe(1)
      expect(onError).not.toHaveBeenCalled()
    })

    it.each(cases)('serves %s from the cache', async (_name, build, expected) => {
      expect(await build().exec()).toEqual(expected)
      await Falsy.create({ name: 'x', n: 1 })
      const before = reads
      expect(await build().exec()).toEqual(expected)
      expect(reads).toBe(before)
      expect(onError).not.toHaveBeenCalled()
    })
  })
}
