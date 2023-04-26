import _ from 'lodash'
import { createHash } from 'crypto'

export function sortDeep (data: Record<string, unknown>[] | Record<string, unknown>): unknown {
  if (_.isObjectLike(data) && _.isArray(data)) {
    return data.map(sortDeep)
  }

  if (_.isObjectLike(data) && !_.isArray(data)) {
    const sortedKeys = _.keys(data).sort((a, b) => a.localeCompare(b))
    const sortedObj: Record<string, unknown> = {}

    sortedKeys.forEach((key) => {
      sortedObj[key] = sortDeep(data[key] as Record<string, unknown>[] | Record<string, unknown>)
    })

    return sortedObj
  }

  return data
}

export function getKey (data: Record<string, unknown>[] | Record<string, unknown>): string {
  const sortedObj = sortDeep(data)
  const sortedStr = JSON.stringify(sortedObj)
  return createHash('sha256').update(sortedStr).digest('hex')
}
