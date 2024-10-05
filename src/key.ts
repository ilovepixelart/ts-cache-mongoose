import { createHash } from 'node:crypto'
import sortKeys from 'sort-keys'

export function getKey(data: Record<string, unknown>[] | Record<string, unknown>): string {
  const sortedObj = sortKeys(data, { deep: true })
  const sortedStr = JSON.stringify(sortedObj, (_, val: unknown) => {
    return val instanceof RegExp ? String(val) : val
  })
  return createHash('sha1').update(sortedStr).digest('hex')
}
