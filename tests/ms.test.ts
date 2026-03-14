import { describe, expect, it } from 'vitest'

import { ms } from '../src/ms'

describe('ms', () => {
  it('should parse seconds', () => {
    expect(ms('1s')).toBe(1000)
    expect(ms('5 seconds')).toBe(5000)
    expect(ms('30 sec')).toBe(30000)
    expect(ms('1 second')).toBe(1000)
    expect(ms('2 secs')).toBe(2000)
  })

  it('should parse minutes', () => {
    expect(ms('1m')).toBe(60000)
    expect(ms('5 minutes')).toBe(300000)
    expect(ms('1 minute')).toBe(60000)
    expect(ms('2 min')).toBe(120000)
    expect(ms('3 mins')).toBe(180000)
  })

  it('should parse hours', () => {
    expect(ms('1h')).toBe(3600000)
    expect(ms('2 hours')).toBe(7200000)
    expect(ms('1 hour')).toBe(3600000)
    expect(ms('3 hr')).toBe(10800000)
    expect(ms('4 hrs')).toBe(14400000)
  })

  it('should parse days', () => {
    expect(ms('1d')).toBe(86400000)
    expect(ms('2 days')).toBe(172800000)
    expect(ms('1 day')).toBe(86400000)
  })

  it('should parse weeks', () => {
    expect(ms('1w')).toBe(604800000)
    expect(ms('2 weeks')).toBe(1209600000)
    expect(ms('1 week')).toBe(604800000)
  })

  it('should parse years', () => {
    expect(ms('1y')).toBe(31557600000)
    expect(ms('1 year')).toBe(31557600000)
    expect(ms('2 yrs')).toBe(63115200000)
    expect(ms('1 yr')).toBe(31557600000)
  })

  it('should parse milliseconds', () => {
    expect(ms('100ms')).toBe(100)
    expect(ms('500 milliseconds')).toBe(500)
    expect(ms('1 millisecond')).toBe(1)
    expect(ms('200 msec')).toBe(200)
    expect(ms('300 msecs')).toBe(300)
  })

  it('should parse decimal values', () => {
    expect(ms('1.5h')).toBe(5400000)
    expect(ms('0.5d')).toBe(43200000)
    expect(ms('.5s')).toBe(500)
  })

  it('should parse negative values', () => {
    expect(ms('-1s')).toBe(-1000)
    expect(ms('-3m')).toBe(-180000)
  })

  it('should default to milliseconds without unit', () => {
    expect(ms('100')).toBe(100)
    expect(ms('0')).toBe(0)
  })

  it('should be case insensitive', () => {
    expect(ms('1S')).toBe(1000)
    expect(ms('1M')).toBe(60000)
    expect(ms('1H')).toBe(3600000)
  })

  it('should return 0 for invalid strings', () => {
    expect(ms('invalid')).toBe(0)
    expect(ms('')).toBe(0)
    expect(ms('abc123')).toBe(0)
  })

  it('should return 0 for strings longer than 100 characters', () => {
    expect(ms('a'.repeat(101))).toBe(0)
  })

  it('should handle whitespace between number and unit', () => {
    expect(ms('1 s')).toBe(1000)
    expect(ms('5  minutes')).toBe(300000)
  })
})
