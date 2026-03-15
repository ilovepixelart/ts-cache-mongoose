import { describe, expect, it } from 'vitest'

import { ms, UNITS } from '../src/ms'

const { s, m, h, d, w, mo, y } = UNITS

describe('ms', () => {
  it('should parse milliseconds', () => {
    expect(ms('100ms')).toBe(100)
    expect(ms('500 milliseconds')).toBe(500)
    expect(ms('1 millisecond')).toBe(1)
    expect(ms('200 msec')).toBe(200)
    expect(ms('300 msecs')).toBe(300)
  })

  it('should parse seconds', () => {
    expect(ms('1s')).toBe(s)
    expect(ms('5 seconds')).toBe(5 * s)
    expect(ms('30 sec')).toBe(30 * s)
    expect(ms('1 second')).toBe(s)
    expect(ms('2 secs')).toBe(2 * s)
  })

  it('should parse minutes', () => {
    expect(ms('1m')).toBe(m)
    expect(ms('5 minutes')).toBe(5 * m)
    expect(ms('1 minute')).toBe(m)
    expect(ms('2 min')).toBe(2 * m)
    expect(ms('3 mins')).toBe(3 * m)
  })

  it('should parse hours', () => {
    expect(ms('1h')).toBe(h)
    expect(ms('2 hours')).toBe(2 * h)
    expect(ms('1 hour')).toBe(h)
    expect(ms('3 hr')).toBe(3 * h)
    expect(ms('4 hrs')).toBe(4 * h)
  })

  it('should parse days', () => {
    expect(ms('1d')).toBe(d)
    expect(ms('2 days')).toBe(2 * d)
    expect(ms('1 day')).toBe(d)
  })

  it('should parse weeks', () => {
    expect(ms('1w')).toBe(w)
    expect(ms('2 weeks')).toBe(2 * w)
    expect(ms('1 week')).toBe(w)
  })

  it('should parse months', () => {
    expect(ms('1mo')).toBe(mo)
    expect(ms('1 month')).toBe(mo)
    expect(ms('2 months')).toBe(2 * mo)
    expect(ms('6mo')).toBe(6 * mo)
    expect(ms('0.5mo')).toBe(0.5 * mo)
  })

  it('should parse years', () => {
    expect(ms('1y')).toBe(y)
    expect(ms('1 year')).toBe(y)
    expect(ms('2 yrs')).toBe(2 * y)
    expect(ms('1 yr')).toBe(y)
  })

  it('should parse decimal values', () => {
    expect(ms('1.5h')).toBe(1.5 * h)
    expect(ms('0.5d')).toBe(0.5 * d)
    expect(ms('.5s')).toBe(0.5 * s)
  })

  it('should parse negative values', () => {
    expect(ms('-1s')).toBe(-s)
    expect(ms('-3m')).toBe(-3 * m)
  })

  it('should default to milliseconds without unit', () => {
    expect(ms('100')).toBe(100)
    expect(ms('0')).toBe(0)
  })

  it('should be case insensitive', () => {
    // @ts-expect-error runtime check
    expect(ms('1S')).toBe(s)
    // @ts-expect-error runtime check
    expect(ms('1M')).toBe(m)
    // @ts-expect-error runtime check
    expect(ms('1H')).toBe(h)
  })

  it('should return NaN for invalid strings', () => {
    // @ts-expect-error testing invalid input
    expect(ms('invalid')).toBeNaN()
    // @ts-expect-error testing invalid input
    expect(ms('')).toBeNaN()
    // @ts-expect-error testing invalid input
    expect(ms('abc123')).toBeNaN()
  })

  it('should return NaN for strings longer than 100 characters', () => {
    // @ts-expect-error testing invalid input
    expect(ms('a'.repeat(101))).toBeNaN()
  })

  it('should handle whitespace between number and unit', () => {
    expect(ms('1 s')).toBe(s)
    expect(ms('5  minutes')).toBe(5 * m)
    expect(ms('1 mo')).toBe(mo)
    expect(ms('1 week')).toBe(w)
    expect(ms('1 year')).toBe(y)
  })
})
