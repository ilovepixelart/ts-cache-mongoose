const s = 1000
const m = s * 60
const h = m * 60
const d = h * 24
const w = d * 7
const y = d * 365.25
const mo = y / 12

export const UNITS = {
  milliseconds: 1,
  millisecond: 1,
  msecs: 1,
  msec: 1,
  ms: 1,
  seconds: s,
  second: s,
  secs: s,
  sec: s,
  s,
  minutes: m,
  minute: m,
  mins: m,
  min: m,
  m,
  hours: h,
  hour: h,
  hrs: h,
  hr: h,
  h,
  days: d,
  day: d,
  d,
  weeks: w,
  week: w,
  w,
  months: mo,
  month: mo,
  mo,
  years: y,
  year: y,
  yrs: y,
  yr: y,
  y,
} as const satisfies Record<string, number>

export type Unit = keyof typeof UNITS

export type Duration = number | `${number}` | `${number}${Unit}` | `${number} ${Unit}`

const unitPattern = Object.keys(UNITS)
  .sort((a, b) => b.length - a.length)
  .join('|')

const RE = new RegExp(String.raw`^(-?(?:\d+)?\.?\d+)\s*(${unitPattern})?$`, 'i')

export const ms = (val: Duration): number => {
  const str = String(val)
  if (str.length > 100) return Number.NaN

  const match = RE.exec(str)
  if (!match) return Number.NaN

  const n = Number.parseFloat(match[1] ?? '')
  const type = (match[2] ?? 'ms').toLowerCase()
  return n * (UNITS[type as Unit] ?? 0)
}
