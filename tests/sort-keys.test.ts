import { describe, expect, it } from 'vitest'

import { sortKeys } from '../src/sort-keys'

describe('sortKeys', () => {
  it('should sort object keys alphabetically', () => {
    expect(sortKeys({ c: 1, a: 2, b: 3 })).toEqual({ a: 2, b: 3, c: 1 })
  })

  it('should sort nested objects deeply', () => {
    expect(sortKeys({ b: { d: 1, c: 2 }, a: 1 })).toEqual({ a: 1, b: { c: 2, d: 1 } })
  })

  it('should sort arrays of objects', () => {
    const input = [
      { b: 1, a: 2 },
      { d: 3, c: 4 },
    ]
    const expected = [
      { a: 2, b: 1 },
      { c: 4, d: 3 },
    ]
    expect(sortKeys(input)).toEqual(expected)
  })

  it('should handle nested arrays', () => {
    const input = { items: [{ z: 1, a: 2 }] }
    expect(sortKeys(input)).toEqual({ items: [{ a: 2, z: 1 }] })
  })

  it('should handle nested arrays of arrays', () => {
    const input = { data: [[{ b: 1, a: 2 }]] }
    expect(sortKeys(input)).toEqual({ data: [[{ a: 2, b: 1 }]] })
  })

  it('should preserve non-object values in arrays', () => {
    const input = { items: [1, 'string', true, null] }
    expect(sortKeys(input)).toEqual({ items: [1, 'string', true, null] })
  })

  it('should handle empty objects', () => {
    expect(sortKeys({})).toEqual({})
  })

  it('should handle empty arrays', () => {
    expect(sortKeys([])).toEqual([])
  })

  it('should handle deeply nested structures', () => {
    const input = { c: { b: { a: { z: 1, y: 2 } } } }
    expect(sortKeys(input)).toEqual({ c: { b: { a: { y: 2, z: 1 } } } })
  })

  it('should not modify non-plain objects', () => {
    const date = new Date()
    const input = { b: date, a: 1 }
    const result = sortKeys(input) as Record<string, unknown>
    expect(result.a).toBe(1)
    expect(result.b).toBe(date)
  })

  it('should handle circular references without infinite loop', () => {
    const obj: Record<string, unknown> = { a: 1 }
    obj.self = obj
    const result = sortKeys(obj)
    expect(result).toBeDefined()
  })

  it('should produce deterministic output regardless of input order', () => {
    const a = sortKeys({ z: 1, a: 2, m: 3 })
    const b = sortKeys({ a: 2, m: 3, z: 1 })
    expect(JSON.stringify(a)).toBe(JSON.stringify(b))
  })

  it('should handle top-level array input', () => {
    const input = [{ b: 1, a: 2 }] as Record<string, unknown>[]
    const result = sortKeys(input)
    expect(result).toEqual([{ a: 2, b: 1 }])
  })
})
