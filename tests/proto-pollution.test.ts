import { afterEach, describe, expect, it } from 'vitest'

import { EJSON } from 'bson'

// Regression test: attacker-controlled payloads read from Redis can pass
// through bson's EJSON.parse without polluting Object.prototype. We depend
// on this every time we rehydrate cached query results from an engine the
// library does not own (Redis can be shared infra, MITM'd, or outright
// compromised). If a future bson release regresses to manual
// `result[key] = ...` during reviver handling, __proto__ assignment would
// start walking up the prototype chain and pollute the base Object — this
// test locks that assumption in place.

describe('EJSON.parse prototype pollution regression', () => {
  afterEach(() => {
    // Defence in depth: make sure no earlier assertion accidentally left
    // state on Object.prototype that would mask a regression in a later
    // test in the same process.
    // biome-ignore lint/suspicious/noExplicitAny: inspecting the global prototype
    const proto = Object.prototype as any
    delete proto.polluted
    delete proto.polluted2
    delete proto.polluted3
  })

  it('does not pollute Object.prototype via a top-level __proto__ key', () => {
    const payload = '{"__proto__": {"polluted": "yes"}, "normal": 1}'
    EJSON.parse(payload)
    // biome-ignore lint/suspicious/noExplicitAny: reading an expando off the global prototype
    expect(({} as any).polluted).toBeUndefined()
    // biome-ignore lint/suspicious/noExplicitAny: inspecting the global prototype
    expect((Object.prototype as any).polluted).toBeUndefined()
  })

  it('does not pollute Object.prototype via a nested __proto__ key', () => {
    const payload = '{"inner": {"__proto__": {"polluted2": "yes"}}}'
    EJSON.parse(payload)
    // biome-ignore lint/suspicious/noExplicitAny: reading an expando off the global prototype
    expect(({} as any).polluted2).toBeUndefined()
  })

  it('does not pollute Object.prototype via a constructor.prototype path', () => {
    const payload = '{"constructor": {"prototype": {"polluted3": "yes"}}}'
    EJSON.parse(payload)
    // biome-ignore lint/suspicious/noExplicitAny: reading an expando off the global prototype
    expect(({} as any).polluted3).toBeUndefined()
  })

  it('ignores a poisoned cached payload when hydrated into a plain object', () => {
    // Mirrors the code path taken by extendQuery/extendAggregate: the raw
    // JSON string lives in Redis, we run it through EJSON.parse, and the
    // result is then spread into consumer code. None of that should leak
    // into Object.prototype.
    const poisoned = '{"__proto__": {"polluted": "leaked"}, "data": [{"a": 1}]}'
    const rehydrated = EJSON.parse(poisoned) as Record<string, unknown>
    const fresh: Record<string, unknown> = {}
    Object.assign(fresh, rehydrated)
    // biome-ignore lint/suspicious/noExplicitAny: reading an expando off the global prototype
    expect(({} as any).polluted).toBeUndefined()
    expect(fresh.data).toEqual([{ a: 1 }])
  })
})
