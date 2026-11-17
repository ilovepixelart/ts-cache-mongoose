import mongoose from 'mongoose'

// Everything a user can observe on a query result, as one canonical string: the data in key
// order, with BSON, Date, Buffer and BigInt values tagged so that look-alikes stay apart, and
// for documents also their class, state, defaults, selection and populated paths.

const POPULATE_PATHS = ['author', 'authors', 'comments.by', 'country']

type Doc = InstanceType<typeof mongoose.Document> & {
  constructor: { modelName: string }
  schema: { paths: Record<string, unknown> }
  $isDefault: (path: string) => boolean
  isSelected: (path: string) => boolean
  populated: (path: string) => unknown
}

const isDocument = (value: unknown): value is Doc => value instanceof mongoose.Document

const modelsOf = (value: unknown): unknown => {
  if (Array.isArray(value)) return value.map(modelsOf)
  if (isDocument(value)) return value.constructor.modelName
  return value == null ? null : typeof value
}

const observeDocument = (doc: Doc): unknown => {
  const paths = Object.keys(doc.schema.paths)
  return {
    model: doc.constructor.modelName,
    isNew: doc.isNew,
    object: doc.toObject({ flattenMaps: true, depopulate: false, minimize: false, transform: false, virtuals: false, getters: false }),
    json: doc.toJSON({ flattenMaps: true, virtuals: true, getters: true }),
    modified: doc.modifiedPaths(),
    defaults: paths.filter((path) => doc.$isDefault(path)),
    selected: paths.filter((path) => doc.isSelected(path)),
    populated: POPULATE_PATHS.map((path) => doc.populated(path) ?? null),
    populatedModels: POPULATE_PATHS.map((path) => modelsOf(doc.get(path))),
    populatedDocs: POPULATE_PATHS.map((path) => observe(doc.get(path))),
  }
}

export const observe = (value: unknown): unknown => {
  if (Array.isArray(value)) return value.map(observe)
  if (isDocument(value)) return observeDocument(value)
  return value ?? null
}

function tag(this: Record<string, unknown>, key: string, value: unknown): unknown {
  const original = this[key]
  return tagValue(original, value)
}

const tagValue = (original: unknown, value: unknown): unknown => {
  if (typeof original === 'bigint') return { $bigint: String(original) }
  if (original instanceof Date) return { $date: Number.isNaN(original.getTime()) ? 'invalid' : original.toISOString() }
  if (Buffer.isBuffer(original)) return { $buffer: original.toString('hex') }
  const bsontype = (original as { _bsontype?: unknown } | null)?._bsontype
  if (typeof bsontype === 'string') return { $bson: bsontype, value: JSON.stringify(value) }
  if (value === undefined) return { $undefined: true }
  return value
}

export const canonical = (value: unknown): string => JSON.stringify(observe(value), tag)

// The same, with every _id and id value replaced: for results whose ids mongoose generates on
// each load, so that the uncached result is not repeatable.
export const canonicalWithoutIds = (value: unknown): string =>
  JSON.stringify(observe(value), function (this: Record<string, unknown>, key: string, item: unknown) {
    return key === '_id' || key === 'id' ? '<generated>' : tag.call(this, key, item)
  })
