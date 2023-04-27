interface ICacheEngine {
  get: (key: string) => Promise<Record<string, unknown> | Record<string, unknown>[] | undefined> | Record<string, unknown> | Record<string, unknown>[] | undefined
  set: (key: string, value: Record<string, unknown> | Record<string, unknown>[], ttl?: number) => Promise<void> | void
  del: (key: string) => Promise<void> | void
  clear: () => Promise<void> | void
  close: () => Promise<void> | void
}

export default ICacheEngine
