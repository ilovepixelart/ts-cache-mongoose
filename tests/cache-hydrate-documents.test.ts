import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

import mongoose, { Schema } from 'mongoose'
import CacheMongoose from '../src/index'
import { canonical } from './hydrate/observe'
import { server } from './mongo/server'

// Non-lean hits behave like documents loaded from MongoDB: saving one writes what saving the
// uncached document writes, and populate forms a hit cannot restore exactly are served from
// MongoDB on every call, still equal to the uncached result and without reporting an error.

const T = Schema.Types
const Person = mongoose.model('HydDocPerson', new Schema({ name: String, kind: String }))
const ArticleSchema = new Schema({
  title: String,
  status: { type: String, default: 'draft' },
  tags: [String],
  views: { type: Number, default: 0 },
  author: { type: T.ObjectId, ref: 'HydDocPerson' },
  readers: [{ type: T.ObjectId, ref: 'HydDocPerson' }],
  ownerKind: String,
  owner: { type: T.ObjectId, refPath: 'ownerKind' },
  editor: { type: T.ObjectId, ref: () => 'HydDocPerson' },
})
ArticleSchema.virtual('mentions', { ref: 'HydDocPerson', localField: 'title', foreignField: 'name' })
const Article = mongoose.model('HydDocArticle', ArticleSchema)

describe('non-lean cache hits as documents', () => {
  const instance = server('cache-hydrate-documents')
  const onError = vi.fn()
  let reads = 0
  let cache: CacheMongoose
  let ada: InstanceType<typeof Person>
  let bob: InstanceType<typeof Person>

  beforeAll(async () => {
    cache = CacheMongoose.init(mongoose, { engine: 'memory', onError })
    await instance.create()
    mongoose.set('debug', (_collection: string, method: string) => {
      if (method === 'find' || method === 'findOne') reads++
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
    await Person.deleteMany({})
    await Article.deleteMany({})
    ada = await Person.create({ name: 'ada', kind: 'x' })
    bob = await Person.create({ name: 'bob' })
    // As another writer left it: no status, tags or views, so their defaults apply on load.
    await Article.collection.insertOne({ title: 'ada', author: ada._id, readers: [ada._id, bob._id], ownerKind: 'HydDocPerson', owner: bob._id, editor: ada._id })
  })

  describe('saving a hit', () => {
    const saved = async (load: () => Promise<InstanceType<typeof Article> | null>) => {
      const before = await Article.collection.findOne({ title: 'ada' })
      const doc = await load()
      if (!doc) throw new Error('expected a document')
      doc.views = 5
      await doc.save()
      const after = await Article.collection.findOne({ title: 'ada' })
      if (before) await Article.collection.replaceOne({ _id: before._id }, before)
      return after
    }

    it('writes what saving the uncached document writes', async () => {
      const expected = await saved(() => Article.findOne({ title: 'ada' }).exec())
      await Article.findOne({ title: 'ada' }).cache()
      const got = await saved(() => Article.findOne({ title: 'ada' }).cache().exec())
      expect(got).toEqual(expected)
    })

    it('writes what saving the uncached document writes, with populated paths', async () => {
      const expected = await saved(() => Article.findOne({ title: 'ada' }).populate('author readers').exec())
      await Article.findOne({ title: 'ada' }).populate('author readers').cache()
      const got = await saved(() => Article.findOne({ title: 'ada' }).populate('author readers').cache().exec())
      expect(got).toEqual(expected)
    })

    it('writes what saving the uncached document writes, after a projection', async () => {
      const expected = await saved(() => Article.findOne({ title: 'ada' }).select('title views').exec())
      await Article.findOne({ title: 'ada' }).select('title views').cache()
      const got = await saved(() => Article.findOne({ title: 'ada' }).select('title views').cache().exec())
      expect(got).toEqual(expected)
    })
  })

  describe('populate that is served from MongoDB on every call', () => {
    const cases: [string, () => mongoose.Query<unknown, unknown>][] = [
      ['a virtual populate', () => Article.find({}).populate('mentions')],
      ['populate with options.lean', () => Article.find({}).populate({ path: 'author', options: { lean: true } })],
      ['a refPath', () => Article.find({}).populate('owner')],
      ['a match that filters a populated array', () => Article.find({}).populate({ path: 'readers', match: { name: 'bob' } })],
      ['a ref function', () => Article.find({}).populate('editor')],
      ['a populated array cut by perDocumentLimit', () => Article.find({}).populate({ path: 'readers', perDocumentLimit: 1 })],
      ['a reference to a deleted document', () => Article.find({}).populate('author')],
    ]

    it.each(cases)('%s', async (name, build) => {
      if (name === 'a reference to a deleted document') await Person.deleteOne({ _id: ada._id })
      reads = 0
      const truth = await build().exec()
      const uncachedReads = reads
      reads = 0
      const first = await build().cache().exec()
      const second = await build().cache().exec()
      expect(reads).toBe(2 * uncachedReads)
      expect(canonical(first)).toBe(canonical(truth))
      expect(canonical(second)).toBe(canonical(truth))
      expect(onError).not.toHaveBeenCalled()
    })
  })

  it('serves a query whose post hook changes documents from MongoDB on every call', async () => {
    const schema = new Schema({ title: String })
    schema.post('find', (docs: { title?: string }[]) => {
      for (const doc of docs) doc.title = `${doc.title}!`
    })
    const Hooked = mongoose.model('HydDocHooked', schema, Article.collection.name)
    reads = 0
    const truth = await Hooked.find({ title: 'ada' })
    const first = await Hooked.find({ title: 'ada' }).cache()
    const second = await Hooked.find({ title: 'ada' }).cache()
    expect(reads).toBe(3)
    expect(canonical(first)).toBe(canonical(truth))
    expect(canonical(second)).toBe(canonical(truth))
    expect(onError).not.toHaveBeenCalled()
  })

  it('reports a hit it cannot rebuild and serves the query from MongoDB', async () => {
    await Article.find({}).cache()
    const init = vi.spyOn(Article.prototype, '$init').mockImplementationOnce(() => {
      throw new Error('init failed')
    })
    reads = 0
    const result = await Article.find({}).cache()
    init.mockRestore()
    expect(result.map((doc) => doc.title)).toEqual(['ada'])
    expect(reads).toBe(1)
    expect(onError).toHaveBeenCalledWith(expect.objectContaining({ message: 'init failed' }))
  })

  it('reports a result it cannot convert, returns it, and does not cache it', async () => {
    const toObject = vi.spyOn(Article.prototype, 'toObject').mockImplementationOnce(() => {
      throw new Error('toObject failed')
    })
    reads = 0
    const miss = await Article.find({}).cache()
    toObject.mockRestore()
    const next = await Article.find({}).cache()
    expect(miss.map((doc) => doc.title)).toEqual(['ada'])
    expect(next.map((doc) => doc.title)).toEqual(['ada'])
    expect(reads).toBe(2)
    expect(onError).toHaveBeenCalledWith(expect.objectContaining({ message: 'toObject failed' }))
  })
})
