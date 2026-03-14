const s = 1000
const m = s * 60
const h = m * 60
const d = h * 24
const w = d * 7
const y = d * 365.25

// NOSONAR — regex from ms package, intentionally covers all time unit aliases
const RE = /^(-?(?:\d+)?\.?\d+)\s*(milliseconds?|msecs?|ms|seconds?|secs?|s|minutes?|mins?|m|hours?|hrs?|h|days?|d|weeks?|w|years?|yrs?|y)?$/i

const UNITS: Record<string, number> = {
  years: y,
  year: y,
  yrs: y,
  yr: y,
  y,
  weeks: w,
  week: w,
  w,
  days: d,
  day: d,
  d,
  hours: h,
  hour: h,
  hrs: h,
  hr: h,
  h,
  minutes: m,
  minute: m,
  mins: m,
  min: m,
  m,
  seconds: s,
  second: s,
  secs: s,
  sec: s,
  s,
  milliseconds: 1,
  millisecond: 1,
  msecs: 1,
  msec: 1,
  ms: 1,
}

export const ms = (val: string): number => {
  const str = String(val)
  if (str.length > 100) return 0

  const match = RE.exec(str)
  if (!match) return 0

  const n = Number.parseFloat(match[1] as string)
  const type = ((match[2] as string | undefined) ?? 'ms').toLowerCase()
  return n * (UNITS[type] ?? 0)
}
