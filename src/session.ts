import type { Model } from 'mongoose'

type TransactionStorage = { getStore: () => { session?: unknown } | undefined }

// Mirrors how mongoose picks a session: an explicit .session() (null opts out), otherwise the
// session of the surrounding connection.transaction() when transactionAsyncLocalStorage is on
// (mongoose 8.4+; the storage does not exist on older versions).
export function runsInSession(options: { session?: unknown }, model: Model<unknown> | undefined): boolean {
  if (Object.hasOwn(options, 'session')) return options.session != null
  const base = model?.db?.base as { transactionAsyncLocalStorage?: TransactionStorage } | undefined
  return base?.transactionAsyncLocalStorage?.getStore()?.session != null
}
