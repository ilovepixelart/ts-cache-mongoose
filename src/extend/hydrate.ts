import mongoose from 'mongoose'
import { getKey } from '../key'

import type { Query } from 'mongoose'
import type { CacheData } from '../types'

// Non-lean find and findOne results are cached as plain data and rebuilt on a hit the way
// mongoose builds documents from a MongoDB reply: the query's projection decides which
// defaults apply, and populated paths hold documents of their model, marked as populated.
// The members below are mongoose internals present from mongoose 6 to 9.

type Plain = Record<string, unknown>

type PopulateOption = { path: string; select?: unknown; populate?: unknown; model?: unknown; options?: { lean?: unknown } }

type SchemaTypeLike = { instance?: string; options?: { ref?: unknown }; caster?: SchemaTypeLike; embeddedSchemaType?: SchemaTypeLike; $embeddedSchemaType?: SchemaTypeLike }

type SchemaLike = {
  paths: Record<string, SchemaTypeLike>
  path: (path: string) => SchemaTypeLike | undefined
  discriminatorMapping?: { key: string; value: unknown; isRoot: boolean }
}

type DocumentLike = {
  $__: unknown
  _id?: unknown
  schema: SchemaLike
  constructor: unknown
  toObject: (options: Plain) => Plain
  get: (path: string, type?: unknown, options?: Plain) => unknown
  $isDefault: (path: string) => boolean
  isModified: () => boolean
  isSelected: (path: string) => boolean
  populated: (path: string) => unknown
  $populated: ((path: string, value: true) => { options?: object } | undefined) & ((path: string, value: unknown, options: Plain) => unknown)
  $init: (data: Plain, options?: { populated: Plain[] }) => unknown
}

type ConnectionLike = { models: Record<string, ModelLike | undefined>; _parent?: ConnectionLike | null; model: (name: string) => ModelLike }

type ModelLike = {
  modelName: string
  baseModelName?: string
  schema: SchemaLike
  db: ConnectionLike
  discriminators?: Record<string, ModelLike>
  find: (filter?: Plain, projection?: unknown) => QueryLike
  new (doc: undefined, fields: unknown, options: Plain): DocumentLike
}

type QueryLike = {
  _fields?: unknown
  _userProvidedFields?: unknown
  _applyPaths: () => void
  populate: (populate: unknown) => QueryLike
  mongooseOptions: () => { populate?: Record<string, PopulateOption> }
}

type Fields = { fields: unknown; userFields: unknown }

// The plain data of a document, exactly as loaded: populated paths kept as their documents'
// data, maps as objects, and none of the schema's toObject settings applied.
const DATA_OPTIONS = {
  depopulate: false,
  flattenMaps: true,
  minimize: false,
  versionKey: true,
  transform: false,
  virtuals: false,
  getters: false,
  aliases: false,
  useProjection: false,
  flattenObjectIds: false,
  flattenDecimals: false,
  flattenUUIDs: false,
  schemaFieldsOnly: false,
}

// mongoose keeps the populated model under a module-private symbol; it is read from a populated
// document of a miss and needed to mark rebuilt paths as populated the way mongoose does.
let populateModelKey: symbol | undefined

const isPlain = (value: unknown): value is Plain => {
  if (value === null || typeof value !== 'object') return false
  const proto: unknown = Object.getPrototypeOf(value)
  return proto === Object.prototype || proto === null
}

const isDocument = (value: unknown): value is DocumentLike => value != null && typeof value === 'object' && '$__' in value && typeof (value as { toObject?: unknown }).toObject === 'function'

const sameValue = (a: unknown, b: unknown): boolean => getKey({ v: a ?? null }) === getKey({ v: b ?? null })

type BsonLike = Record<string, unknown> & { EJSON: { serialize: (value: unknown, options: Plain) => Plain; deserialize: (value: Plain, options: Plain) => unknown } }

// The driver's bson: `mongo.BSON` exists from mongoose 6 on, though mongoose 6's types omit it.
const driverBson = (mongoose.mongo as unknown as { BSON: BsonLike }).BSON
const driverClass = (type: string): unknown => driverBson[type === 'ObjectID' ? 'ObjectId' : type]

// Cached data can hold BSON values of another instance of the bson package than the driver's:
// the engine's EJSON.parse() resolves `bson` itself, and its ESM build or another version is a
// separate set of classes. mongoose drops Decimal128 and Binary values of foreign classes when
// it casts them, so every such value is rebuilt with the driver's classes. Keys are defined,
// never assigned, so data keys such as "__proto__" stay plain own properties.
const withDriverBson = (value: unknown): unknown => {
  if (Array.isArray(value)) return value.map(withDriverBson)
  if (value === null || typeof value !== 'object') return value
  const type = (value as { _bsontype?: unknown })._bsontype
  if (typeof type === 'string') {
    const own = driverClass(type)
    if (typeof own === 'function' && value instanceof own) return value
    return (driverBson.EJSON.deserialize(driverBson.EJSON.serialize({ v: value }, { relaxed: false }), { relaxed: false }) as Plain).v
  }
  if (!isPlain(value)) return value
  const copy: Plain = {}
  for (const key of Object.keys(value)) {
    Object.defineProperty(copy, key, { value: withDriverBson(value[key]), enumerable: true, writable: true, configurable: true })
  }
  return copy
}

// Copy of `value` with every value at `parts` replaced by `fn(value)`; arrays on the way, and an
// array at the end, are mapped element by element. Keys are defined, never assigned.
const mapAt = (value: unknown, parts: string[], fn: (leaf: unknown) => unknown): unknown => {
  if (Array.isArray(value)) return value.map((item) => mapAt(item, parts, fn))
  const [head, ...rest] = parts
  if (head === undefined) return fn(value)
  if (!isPlain(value) || !Object.hasOwn(value, head)) return value
  const copy: Plain = { ...value }
  Object.defineProperty(copy, head, { value: mapAt(value[head], rest, fn), enumerable: true, writable: true, configurable: true })
  return copy
}

// The value at `parts`, through arrays, as mongoose's own path lookup returns it.
const getAt = (value: unknown, parts: string[]): unknown => {
  const [head, ...rest] = parts
  if (head === undefined) return value
  if (Array.isArray(value)) return value.map((item) => getAt(item, parts))
  return isPlain(value) && Object.hasOwn(value, head) ? getAt(value[head], rest) : undefined
}

const deleteAt = (value: unknown, parts: string[]): void => {
  const [head, ...rest] = parts
  if (head === undefined || !isPlain(value) || !Object.hasOwn(value, head)) return
  if (rest.length === 0) delete value[head]
  else deleteAt(value[head], rest)
}

const populateList = (populate: unknown): PopulateOption[] => {
  if (populate == null) return []
  if (typeof populate === 'string')
    return populate
      .split(/\s+/)
      .filter(Boolean)
      .map((path) => ({ path }))
  if (Array.isArray(populate)) return populate.flatMap(populateList)
  if (typeof populate !== 'object') return []
  const option = populate as PopulateOption
  // `populate({ path: 'a b' })` populates both paths with the same options.
  return option.path
    .split(/\s+/)
    .filter(Boolean)
    .map((path) => ({ ...option, path }))
}

// mongoose's own lookup for populate: a useDb() connection falls back to its parent's models.
const modelFromConnection = (connection: ConnectionLike, name: string): ModelLike => {
  if (connection.models[name] == null && connection._parent != null) return modelFromConnection(connection._parent, name)
  return connection.model(name)
}

const refOf = (schemaType: SchemaTypeLike | undefined): unknown => {
  const leaf = schemaType?.caster ?? schemaType?.embeddedSchemaType ?? schemaType?.$embeddedSchemaType ?? schemaType
  return leaf?.options?.ref ?? schemaType?.options?.ref
}

// The model that populates `option.path`, for the forms mongoose resolves without the document:
// an explicit `model`, or a `ref` that is a model name or a model. Anything else (refPath, ref
// functions, virtual populate) is left to MongoDB.
const populateModel = (model: ModelLike, option: PopulateOption): ModelLike | undefined => {
  if (option.options?.lean) return undefined
  const schemaType = model.schema.path(option.path)
  if (schemaType == null) return undefined
  const ref = option.model ?? refOf(schemaType)
  if (typeof ref === 'string') return modelFromConnection(model.db, ref)
  if (typeof ref === 'function' && typeof (ref as Partial<ModelLike>).modelName === 'string') return ref as ModelLike
  return undefined
}

const queryFields = (query: QueryLike): Fields => {
  query._applyPaths()
  return { fields: query._fields, userFields: query._userProvidedFields }
}

// What a populate query of `model` selects: its `select`, the schema's `select: false` paths and
// the paths its own nested populate needs.
const populateFields = (model: ModelLike, option: PopulateOption): Fields => {
  const query = model.find({}, option.select ?? null)
  if (option.populate != null) query.populate(option.populate)
  return queryFields(query)
}

const discriminatorOf = (model: ModelLike, data: Plain): ModelLike | undefined => {
  const mapping = model.schema.discriminatorMapping
  if (!mapping?.isRoot || model.discriminators == null) return undefined
  const value = data[mapping.key]
  if (value == null) return undefined
  // By discriminator name, then by its value, which can differ from the name.
  const byName = typeof value === 'string' && Object.hasOwn(model.discriminators, value) ? model.discriminators[value] : undefined
  return byName ?? Object.values(model.discriminators).find((discriminator) => discriminator.schema.discriminatorMapping?.value === value)
}

// mongoose's createModel(): the discriminator named by the data, constructed with the selected
// fields so that defaults apply only to selected paths.
const newDocument = (model: ModelLike, data: Plain, fields: Fields): DocumentLike => {
  const options = { skipId: true, isNew: false, willInit: true }
  const discriminator = discriminatorOf(model, data)
  if (discriminator == null) return new model(undefined, fields.fields, options)
  const userFields = fields.userFields as Plain | null | undefined
  const query = discriminator.find({}, userFields != null && Object.keys(userFields).length > 0 ? userFields : null)
  return new discriminator(undefined, queryFields(query).fields, options)
}

const isArrayType = (schemaType: SchemaTypeLike | undefined): boolean => schemaType?.instance === 'Array' || schemaType?.instance === 'DocumentArray'

// The ids mongoose records for a populated path: those of the populated data, and an empty
// list for a selected path that is, or runs through, an array and is not in the data.
const idsOf = (model: ModelLike, data: Plain, parts: string[], selected: boolean): unknown => {
  const ids = getAt(
    mapAt(data, parts, (leaf) => (isPlain(leaf) ? leaf._id : leaf)),
    parts,
  )
  if (ids !== undefined || !selected) return ids
  return parts.some((_, i) => isArrayType(model.schema.path(parts.slice(0, i + 1).join('.')))) ? [] : undefined
}

const leavesOf = (value: unknown): unknown[] => (Array.isArray(value) ? value.flatMap(leavesOf) : [value])

// Whether rebuild() can restore every populated path of this data: each one resolves to a model,
// and the key mongoose marks populated paths with is known when a path gets marked. Checked
// before rebuilding anything, so that no init hook runs for a hit that falls back to MongoDB.
const rebuildable = (model: ModelLike, data: Plain, options: PopulateOption[]): boolean =>
  options.every((option) => {
    const populateWith = populateModel(model, option)
    if (populateWith == null) return false
    const parts = option.path.split('.')
    if (populateModelKey == null && idsOf(model, data, parts, true) != null) return false
    const nested = populateList(option.populate)
    return leavesOf(getAt(data, parts)).every((leaf) => !isPlain(leaf) || rebuildable(populateWith, leaf, nested))
  })

const rebuild = (model: ModelLike, data: Plain, fields: Fields, options: PopulateOption[]): DocumentLike => {
  const doc = newDocument(model, data, fields)
  let current: unknown = data
  const populated: Plain[] = []
  for (const option of options) {
    const populateWith = populateModel(model, option) as ModelLike
    const parts = option.path.split('.')
    const childFields = populateFields(populateWith, option)
    const nested = populateList(option.populate)
    const children: DocumentLike[] = []
    current = mapAt(current, parts, (leaf) => {
      if (!isPlain(leaf)) return leaf
      const child = rebuild(populateWith, leaf, childFields, nested)
      children.push(child)
      return child
    })
    const ids = idsOf(model, data, parts, doc.isSelected(option.path))
    const item: Plain = { ...option, path: option.path, isVirtual: false, _docs: { [String(data._id)]: ids }, _childDocs: children }
    if (populateModelKey != null) Object.defineProperty(item, populateModelKey, { value: populateWith, enumerable: true })
    populated.push(item)
  }
  doc.$init(current as Plain, populated.length > 0 ? { populated } : undefined)
  // $init() marks populated paths and adopts the populated documents only for data with an _id;
  // mongoose's own populate does both regardless.
  if (data._id == null) {
    for (const item of populated) {
      const ids = (item._docs as Plain)[String(data._id)]
      if (ids != null) doc.$populated(item.path as string, ids, item)
      for (const child of item._childDocs as DocumentLike[]) (child.$__ as { parent?: unknown }).parent = doc
    }
  }
  return doc
}

// The subdocuments and populated documents held at one path, each with its data.
const childrenOf = (value: unknown, data: unknown): [DocumentLike, Plain][] => {
  if (isDocument(value)) return isPlain(data) ? [[value, data]] : []
  if (Array.isArray(value) && Array.isArray(data)) return value.flatMap((item: unknown, i) => childrenOf(item, data[i]))
  if (value instanceof Map && isPlain(data)) return [...value].flatMap(([key, item]: [string, unknown]) => childrenOf(item, data[key]))
  return []
}

// Paths in the default state were not in MongoDB's reply; dropping them lets a hit apply the
// same defaults again, in the same state, for the same selected paths.
const stripDefaults = (doc: DocumentLike, data: Plain): void => {
  for (const path of Object.keys(doc.schema.paths)) {
    const parts = path.split('.')
    if (doc.$isDefault(path)) {
      deleteAt(data, parts)
      continue
    }
    for (const [child, childData] of childrenOf(doc.get(path, null, { getters: false }), getAt(data, parts))) {
      stripDefaults(child, childData)
    }
  }
}

const acceptsModel = (expected: ModelLike, actual: unknown): boolean => actual === expected || (expected.discriminators != null && Object.values(expected.discriminators).includes(actual as ModelLike))

// Whether rebuild() reproduces this document's populated paths: every populated value is a
// document of the model rebuild() resolves, and mongoose recorded the ids that data implies.
const rebuildsPopulated = (model: ModelLike, doc: DocumentLike, data: Plain, options: PopulateOption[]): boolean => {
  for (const option of options) {
    const populateWith = populateModel(model, option)
    if (populateWith == null) return false
    const parts = option.path.split('.')
    const docs = leavesOf(doc.get(option.path)).filter((leaf) => leaf != null)
    if (!docs.every((leaf) => isDocument(leaf) && acceptsModel(populateWith, leaf.constructor))) return false
    const expected = idsOf(model, data, parts, doc.isSelected(option.path))
    if (!sameValue(doc.populated(option.path), expected)) return false
    const entry = doc.$populated(option.path, true)
    populateModelKey ??= entry?.options == null ? undefined : Object.getOwnPropertySymbols(entry.options).find((key) => String(key.description).includes('PopulateOptions#Model'))
    const nested = populateList(option.populate)
    const leaves = leavesOf(getAt(data, parts)).filter(isPlain)
    for (const [i, child] of docs.entries()) {
      if (!rebuildsPopulated(populateWith, child as DocumentLike, leaves[i] as Plain, nested)) return false
    }
  }
  return true
}

// Not cached: documents changed after loading (by a post hook), and documents whose _id mongoose
// generated rather than read (mongoose 8 does so for discriminator documents loaded without _id).
const toData = (model: ModelLike, doc: unknown, options: PopulateOption[]): Plain | undefined => {
  if (!isDocument(doc) || doc.isModified() || doc.$isDefault('_id')) return undefined
  const data = doc.toObject(DATA_OPTIONS)
  if (!rebuildsPopulated(model, doc, data, options)) return undefined
  stripDefaults(doc, data)
  return data
}

const populateOptionsOf = (query: QueryLike): PopulateOption[] => Object.values(query.mongooseOptions().populate ?? {}).flatMap(populateList)

/**
 * The cacheable form of a non-lean find or findOne result, or undefined when the result cannot
 * be rebuilt as an equal document (it is then not cached).
 */
export const toCacheData = (query: Query<unknown, unknown>, result: unknown): CacheData => {
  if (result == null) return result as CacheData
  const self = query as unknown as QueryLike & { model: ModelLike }
  const options = populateOptionsOf(self)
  if (!Array.isArray(result)) return toData(self.model, result, options)
  const out: Plain[] = []
  for (const doc of result) {
    const data = toData(self.model, doc, options)
    if (data === undefined) return undefined
    out.push(data)
  }
  return out
}

/**
 * The documents a cached non-lean find or findOne result stands for, or undefined when they
 * cannot be rebuilt here (the query then runs against MongoDB).
 */
export const fromCacheData = (query: Query<unknown, unknown>, cached: CacheData): unknown => {
  const self = query as unknown as QueryLike & { model: ModelLike }
  const options = populateOptionsOf(self)
  const items = (Array.isArray(cached) ? cached : [cached]).map(withDriverBson)
  if (!items.every((item) => isPlain(item) && rebuildable(self.model, item, options))) return undefined
  const fields = queryFields(self)
  const docs = items.map((item) => rebuild(self.model, item as Plain, fields, options))
  return Array.isArray(cached) ? docs : docs[0]
}
