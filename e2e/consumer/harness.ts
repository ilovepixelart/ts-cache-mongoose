import mongoose from 'mongoose'
import { canonical } from '../../tests/hydrate/observe.ts'

import type CacheMongoose from '../../src/index.ts'
import type * as Nest from '../../src/nest/index.ts'

// What every scenario group gets: the package as loaded by the entry point (require or import),
// the connection settings the runner passes, and a counter of MongoDB read commands.

export type Library = typeof CacheMongoose
export type NestLibrary = typeof Nest

export type Loaders = {
  load: () => Promise<Library>
  loadNest: () => Promise<NestLibrary>
}

export type Result = { name: string; ok: boolean; observed?: unknown; error?: string }

export type Context = {
  loaders: Loaders
  uri: string
  db: string
  redis: { host: string; port: number }
  prefix: string
}

const READ_COMMANDS = new Set(['find', 'aggregate', 'count', 'distinct', 'getMore'])

export const reads = { count: 0 }

// Counts the read commands a connection sends to MongoDB, from the driver's command monitoring.
export const monitor = (connection: mongoose.Connection): void => {
  connection.getClient().on('commandStarted', (event: { commandName: string }) => {
    if (READ_COMMANDS.has(event.commandName)) reads.count++
  })
}

export const [mongooseMajor = 0, mongooseMinor = 0] = mongoose.version.split('.').map(Number)

export const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms))

// The observable form of a result (data, BSON classes, document state), as plain JSON.
export const observe = (value: unknown): unknown => JSON.parse(canonical(value))

const MAX_ERROR_LENGTH = 1500

const describeError = (err: unknown): string => {
  const message = err instanceof Error ? `${err.name}: ${err.message}` : String(err)
  return message.length > MAX_ERROR_LENGTH ? `${message.slice(0, MAX_ERROR_LENGTH)}...` : message
}

export class Run {
  readonly results: Result[] = []
  readonly #before: () => Promise<void> | void

  constructor(before: () => Promise<void> | void = () => {}) {
    this.#before = before
  }

  // Runs one scenario with a bound on its duration, so that a stalled cache fails the scenario
  // instead of the whole run.
  async scenario(name: string, fn: () => Promise<unknown>, timeoutMs = 10_000): Promise<void> {
    let timer: NodeJS.Timeout | undefined
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error(`timed out after ${timeoutMs} ms`)), timeoutMs)
    })
    try {
      await Promise.race([this.#before(), timeout])
      reads.count = 0
      const observed = await Promise.race([fn(), timeout])
      this.results.push({ name, ok: true, observed: observed ?? null })
    } catch (err) {
      this.results.push({ name, ok: false, error: describeError(err) })
    } finally {
      clearTimeout(timer)
    }
  }
}
