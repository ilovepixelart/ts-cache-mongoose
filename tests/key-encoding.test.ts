import { describe, expect, it } from 'vitest'

import { Decimal128 } from 'bson'
import { Types } from 'mongoose'
import { getKey } from '../src/key'

// Pairs that MongoDB treats as different queries must never share a key.

const OID = '5f9b3b3b3b3b3b3b3b3b3b3b'
const ISO = '2024-01-01T00:00:00.000Z'

describe('getKey value encoding', () => {
  it.each([
    ['undefined and a missing field', { a: undefined }, {}],
    ['undefined and null', { a: undefined }, { a: null }],
    ['an ObjectId and its hex string', { a: new Types.ObjectId(OID) }, { a: OID }],
    ['a Date and its ISO string', { a: new Date(ISO) }, { a: ISO }],
    ['a Date and its epoch number', { a: new Date(ISO) }, { a: new Date(ISO).getTime() }],
    ['a number and its string', { a: 1 }, { a: '1' }],
    ['a boolean and its string', { a: true }, { a: 'true' }],
    ['a BigInt and its string', { a: 5n }, { a: '5' }],
    ['a RegExp and its source string', { a: /x/i }, { a: '/x/i' }],
    ['a Decimal128 and its extended JSON', { a: Decimal128.fromString('1.5') }, { a: { $numberDecimal: '1.5' } }],
    ['two $where functions', { $where: () => true }, { $where: () => false }],
    ['two Maps', { a: new Map([['x', 1]]) }, { a: new Map([['y', 1]]) }],
    ['a string and the same text in an array', { a: 'x' }, { a: ['x'] }],
  ])('separates %s', (_, one, two) => {
    expect(getKey(one)).not.toBe(getKey(two))
  })

  it('gives equal ObjectIds, Dates and BigInts the same key', () => {
    expect(getKey({ a: new Types.ObjectId(OID), d: new Date(ISO), b: 5n })).toBe(getKey({ a: new Types.ObjectId(OID), d: new Date(ISO), b: 5n }))
  })

  it('encodes a BigInt without throwing', () => {
    expect(getKey({ a: 5n })).toMatch(/^[0-9a-f]{40}$/)
  })

  it('encodes a circular structure without throwing', () => {
    const circular: Record<string, unknown> = { a: 1 }
    circular.self = circular
    expect(getKey({ x: circular })).toMatch(/^[0-9a-f]{40}$/)
  })
})

describe('getKey key order', () => {
  it('keeps the order of a sort specification', () => {
    expect(getKey({ options: { sort: { a: 1, b: 1 } } })).not.toBe(getKey({ options: { sort: { b: 1, a: 1 } } }))
  })

  it('keeps the order of a $sort stage', () => {
    expect(getKey([{ $sort: { a: 1, b: 1 } }])).not.toBe(getKey([{ $sort: { b: 1, a: 1 } }]))
  })

  it('keeps the order of a sortBy inside an expression', () => {
    const stage = (sortBy: Record<string, number>) => [{ $group: { _id: null, top: { $topN: { n: 1, sortBy, output: '$a' } } } }]
    expect(getKey(stage({ a: 1, b: 1 }))).not.toBe(getKey(stage({ b: 1, a: 1 })))
  })

  it('keeps the order of a query filter', () => {
    expect(getKey({ filter: { sub: { x: 1, y: 2 } } })).not.toBe(getKey({ filter: { sub: { y: 2, x: 1 } } }))
  })

  it('still ignores the order of other keys', () => {
    expect(getKey([{ $match: { a: 1, b: 2 } }])).toBe(getKey([{ $match: { b: 2, a: 1 } }]))
    expect(getKey({ options: { limit: 1, skip: 2 } })).toBe(getKey({ options: { skip: 2, limit: 1 } }))
  })
})
