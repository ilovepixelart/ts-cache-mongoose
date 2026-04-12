import { describe, expect, it, vi } from 'vitest'

describe('convertToObject', () => {
  it('passes mongoose 7+ values through unchanged', async () => {
    vi.doMock('mongoose', () => ({ default: { version: '9.4.1' } }))
    vi.resetModules()
    const { convertToObject } = await import('../src/version')

    expect(convertToObject({ a: 1 })).toEqual({ a: 1 })
    expect(convertToObject([{ a: 1 }, { b: 2 }])).toEqual([{ a: 1 }, { b: 2 }])
    expect(convertToObject(42)).toBe(42)
    expect(convertToObject(undefined)).toBeUndefined()

    vi.doUnmock('mongoose')
  })

  it('calls .toObject() on mongoose 6 documents', async () => {
    vi.doMock('mongoose', () => ({ default: { version: '6.12.2' } }))
    vi.resetModules()
    const { convertToObject } = await import('../src/version')

    const doc = {
      a: 1,
      toObject: vi.fn().mockReturnValue({ a: 1, converted: true }),
    }
    const result = convertToObject(doc)
    expect(doc.toObject).toHaveBeenCalledTimes(1)
    expect(result).toEqual({ a: 1, converted: true })

    vi.doUnmock('mongoose')
  })

  it('maps arrays of mongoose 6 documents via .toObject()', async () => {
    vi.doMock('mongoose', () => ({ default: { version: '6.12.2' } }))
    vi.resetModules()
    const { convertToObject } = await import('../src/version')

    const docA = {
      a: 1,
      toObject: vi.fn().mockReturnValue({ a: 1, converted: true }),
    }
    const docB = {
      b: 2,
      toObject: vi.fn().mockReturnValue({ b: 2, converted: true }),
    }
    const result = convertToObject([docA, docB])
    expect(docA.toObject).toHaveBeenCalledTimes(1)
    expect(docB.toObject).toHaveBeenCalledTimes(1)
    expect(result).toEqual([
      { a: 1, converted: true },
      { b: 2, converted: true },
    ])

    vi.doUnmock('mongoose')
  })

  it('passes plain objects through unchanged on mongoose 6 when they do not have toObject', async () => {
    vi.doMock('mongoose', () => ({ default: { version: '6.12.2' } }))
    vi.resetModules()
    const { convertToObject } = await import('../src/version')

    const plain = { a: 1 }
    expect(convertToObject(plain)).toBe(plain)

    vi.doUnmock('mongoose')
  })

  it('passes undefined and primitive values through on mongoose 6', async () => {
    vi.doMock('mongoose', () => ({ default: { version: '6.12.2' } }))
    vi.resetModules()
    const { convertToObject } = await import('../src/version')

    expect(convertToObject(undefined)).toBeUndefined()
    expect(convertToObject(42)).toBe(42)

    vi.doUnmock('mongoose')
  })
})
