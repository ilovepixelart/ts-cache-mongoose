import { describe, expect, it } from 'vitest'

import fc from 'fast-check'
import { ms, UNITS, type Unit } from '../src/ms'

const unitNames = Object.keys(UNITS) as Unit[]

// Positive integer strings without leading zero, so the regex parses
// them back unambiguously and Number.parseFloat round-trips the value.
const positiveIntArb = fc.integer({ min: 1, max: 1_000_000 }).map((n) => String(n))

const unitArb = fc.constantFrom(...unitNames)

describe('ms — properties', () => {
  it('never throws on any string input', () => {
    fc.assert(
      fc.property(fc.string(), (input) => {
        expect(() => ms(input as never)).not.toThrow()
      }),
    )
  })

  it('always returns a number (finite or NaN)', () => {
    fc.assert(
      fc.property(fc.string(), (input) => {
        const result = ms(input as never)
        expect(typeof result).toBe('number')
      }),
    )
  })

  it('returns NaN for inputs longer than 100 characters', () => {
    fc.assert(
      fc.property(fc.integer({ min: 101, max: 5000 }), (length) => {
        const tooLong = 'a'.repeat(length)
        expect(ms(tooLong as never)).toBeNaN()
      }),
    )
  })

  it('parses "<integer><unit>" to the same millisecond count as the unit table says', () => {
    fc.assert(
      fc.property(positiveIntArb, unitArb, (num, unit) => {
        const n = Number.parseInt(num, 10)
        expect(ms(`${n}${unit}` as never)).toBe(n * UNITS[unit])
      }),
    )
  })

  it('parses "<integer> <unit>" (with space) the same way as without', () => {
    fc.assert(
      fc.property(positiveIntArb, unitArb, (num, unit) => {
        expect(ms(`${num} ${unit}` as never)).toBe(ms(`${num}${unit}` as never))
      }),
    )
  })

  it('is case-insensitive on the unit', () => {
    fc.assert(
      fc.property(positiveIntArb, unitArb, (num, unit) => {
        const lower = ms(`${num}${unit}` as never)
        const upper = ms(`${num}${unit.toUpperCase()}` as never)
        expect(upper).toBe(lower)
      }),
    )
  })

  it('defaults to milliseconds when no unit suffix is present', () => {
    fc.assert(
      fc.property(positiveIntArb, (num) => {
        expect(ms(num as never)).toBe(Number.parseInt(num, 10))
      }),
    )
  })

  it('negates for a leading "-" sign', () => {
    fc.assert(
      fc.property(positiveIntArb, unitArb, (num, unit) => {
        const positive = ms(`${num}${unit}` as never)
        const negative = ms(`-${num}${unit}` as never)
        expect(negative).toBe(-positive)
      }),
    )
  })

  it('returns NaN for unknown unit suffixes', () => {
    fc.assert(
      fc.property(
        positiveIntArb,
        fc.stringMatching(/^[a-z]{1,10}$/).filter((u) => !unitNames.includes(u as Unit) && !unitNames.some((n) => n.toLowerCase() === u)),
        (num, bogusUnit) => {
          const result = ms(`${num}${bogusUnit}` as never)
          expect(result).toBeNaN()
        },
      ),
    )
  })

  it('known fixed transformations match', () => {
    expect(ms('1 second' as never)).toBe(1000)
    expect(ms('1 minute' as never)).toBe(60_000)
    expect(ms('1 hour' as never)).toBe(3_600_000)
    expect(ms('1 day' as never)).toBe(86_400_000)
    expect(ms('2 weeks' as never)).toBe(2 * 7 * 86_400_000)
    expect(ms('60 seconds' as never)).toBe(60_000)
    expect(ms(500 as never)).toBe(500)
  })

  it('handles decimals in the numeric portion', () => {
    expect(ms('0.5 seconds' as never)).toBe(500)
    expect(ms('1.5 hours' as never)).toBe(1.5 * 3_600_000)
  })
})
