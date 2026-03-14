const isPlainObject = (value: unknown): value is Record<string, unknown> => {
  if (typeof value !== 'object' || value === null) return false
  const proto = Object.getPrototypeOf(value) as unknown
  return proto === Object.prototype || proto === null
}

export const sortKeys = (input: Record<string, unknown> | Record<string, unknown>[]): Record<string, unknown> | Record<string, unknown>[] => {
  const seen = new WeakSet<object>()

  const sortObject = (obj: Record<string, unknown>): Record<string, unknown> => {
    if (seen.has(obj)) return obj
    seen.add(obj)

    const sorted: Record<string, unknown> = {}
    for (const key of Object.keys(obj).sort((a, b) => a.localeCompare(b))) {
      const value = obj[key]
      if (Array.isArray(value)) {
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
