import { createHash, randomUUID } from 'node:crypto'
import { sortKeys } from './sort-keys'

import type { Model } from 'mongoose'

const encodeObject = (obj: object, stack: object[]): string => {
  const entries = Object.entries(obj).map(([key, val]) => `${JSON.stringify(key)}:${encode(val, stack)}`)
  return `{${entries.join(',')}}`
}

const encodeInstance = (obj: object, stack: object[]): string => {
  if (Array.isArray(obj)) return `[${obj.map((item: unknown) => encode(item, stack)).join(',')}]`
  if (obj instanceof RegExp) return `r${JSON.stringify(String(obj))}`
  if (obj instanceof Date) return `t${obj.getTime()}`
  if (obj instanceof Map) return `m${encode([...obj.entries()], stack)}`
  if (obj instanceof Set) return `s${encode([...obj], stack)}`

  const { _bsontype, toHexString, toJSON } = obj as { _bsontype?: unknown; toHexString?: unknown; toJSON?: unknown }
  if (typeof _bsontype === 'string') {
    if (typeof toHexString === 'function') return `o${String(toHexString.call(obj))}`
    const json: unknown = typeof toJSON === 'function' ? toJSON.call(obj) : obj
    return `x${JSON.stringify(_bsontype)}${json === obj ? encodeObject(obj, stack) : encode(json, stack)}`
  }
  if (typeof toJSON === 'function') {
    const json: unknown = toJSON.call(obj)
    if (json !== obj) return `j${encode(json, stack)}`
  }
  return encodeObject(obj, stack)
}

// A type-tagged, unambiguous serialization: undefined, null, numbers, strings, BigInt,
// ObjectId, Date and RegExp never encode to the same text, unlike JSON.stringify.
const encode = (value: unknown, stack: object[]): string => {
  if (typeof value === 'object') return value === null ? 'n' : encodeReference(value, stack)
  switch (typeof value) {
    case 'string':
      return JSON.stringify(value)
    case 'number':
      return `d${value}`
    case 'boolean':
      return `b${value}`
    case 'bigint':
      return `i${value}`
    case 'symbol':
    case 'function':
      return `f${JSON.stringify(String(value))}`
    default:
      return 'u'
  }
}

const encodeReference = (obj: object, stack: object[]): string => {
  if (stack.includes(obj)) return 'c'
  stack.push(obj)
  const encoded = encodeInstance(obj, stack)
  stack.pop()
  return encoded
}

export function getKey(data: Record<string, unknown>[] | Record<string, unknown>): string {
  const sortedStr = encode(sortKeys(data), [])
  return createHash('sha1').update(sortedStr).digest('hex')
}

export function omitKeys(obj: Record<string, unknown>, keys: readonly string[]): Record<string, unknown> {
  return Object.fromEntries(Object.entries(obj).filter(([key]) => !keys.includes(key)))
}

// Mongoose sets a connection's database name and host when it opens. A query run before that
// is buffered, so the database it reads is not known yet: the connection itself stands in, under
// an id unique to this connection object and process, and never shares an entry.
const pendingConnections = new WeakMap<object, string>()

const pendingConnectionId = (db: object): string => {
  let id = pendingConnections.get(db)
  if (id == null) {
    id = randomUUID()
    pendingConnections.set(db, id)
  }
  return id
}

// The data a model reads: its deployment (first seed host), database and collection. The model
// name stays in the key as well, since discriminators share their base model's collection.
// An aggregate without a model gets no scope and fails in mongoose's own exec, as without a cache.
export function getModelScope(model: Model<unknown> | undefined): Record<string, unknown> {
  if (model == null) return {}
  const { db, collection, modelName } = model
  const scope = { model: modelName, collection: collection.collectionName }
  if (db.name == null || db.host == null) return { ...scope, pendingConnection: pendingConnectionId(db) }
  return { ...scope, db: db.name, host: db.host, port: db.port }
}
