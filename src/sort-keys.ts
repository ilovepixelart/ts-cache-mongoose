const isPlainObject = (value: unknown): value is Record<string, unknown> => {
  if (typeof value !== 'object' || value === null) return false
  const proto = Object.getPrototypeOf(value) as unknown
  return proto === Object.prototype || proto === null
}

// Values whose key order MongoDB honours: a filter (embedded documents match field by field,
// in order) and sort specifications. They are kept as given.
const ORDERED_KEYS = new Set(['filter', 'sort', '$sort', 'sortBy'])

const byName = (a: string, b: string) => a.localeCompare(b)

// An aggregation pipeline is kept as given: its stages hold embedded documents and expressions
// ({ $eq: ['$sub', { a: 1, b: 2 }] }) whose key order MongoDB honours at any depth. Only the
// top-level fields of a $match, which MongoDB ANDs, are put in order.
const sortStage = (stage: unknown): unknown => {
  if (!isPlainObject(stage) || Object.keys(stage).length !== 1 || !isPlainObject(stage.$match)) return stage
  const match = stage.$match
  const fields = Object.keys(match).sort(byName)
  return { $match: Object.fromEntries(fields.map((key) => [key, match[key]])) }
}

export const sortKeys = (input: Record<string, unknown> | Record<string, unknown>[]): Record<string, unknown> | Record<string, unknown>[] => {
  const seen = new WeakSet<object>()

  const sortObject = (obj: Record<string, unknown>): Record<string, unknown> => {
    if (seen.has(obj)) return obj
    seen.add(obj)

    const sorted: Record<string, unknown> = {}
    for (const key of Object.keys(obj).sort(byName)) {
      const value = obj[key]
      if (key === 'pipeline' && Array.isArray(value)) {
        sorted[key] = value.map(sortStage)
      } else if (ORDERED_KEYS.has(key)) {
        sorted[key] = value
      } else if (Array.isArray(value)) {
        sorted[key] = sortArray(value)
      } else if (isPlainObject(value)) {
        sorted[key] = sortObject(value)
      } else {
        sorted[key] = value
      }
    }
    return sorted
  }

  const sortArray = (arr: unknown[]): unknown[] => {
    return arr.map((item) => {
      if (Array.isArray(item)) return sortArray(item)
      if (isPlainObject(item)) return sortObject(item)
      return item
    })
  }

  if (Array.isArray(input)) return sortArray(input) as Record<string, unknown>[]
  return sortObject(input)
}
