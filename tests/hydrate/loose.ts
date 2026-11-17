// The matrix drives many unrelated schemas through one code path; this is the slice of the
// mongoose Model and Query API it uses, without each schema's generated types.

export type LooseQuery = {
  sort: (sort: unknown) => LooseQuery
  select: (projection: unknown) => LooseQuery
  populate: (populate: unknown) => LooseQuery
  lean: () => LooseQuery
  limit: (limit: number) => LooseQuery
  skip: (skip: number) => LooseQuery
  cache: () => LooseQuery
  exec: () => Promise<unknown>
}

export type LooseModel = {
  find: (filter?: unknown) => LooseQuery
  findOne: (filter?: unknown) => LooseQuery
  distinct: (field: string, filter?: unknown) => LooseQuery
  countDocuments: (filter?: unknown) => LooseQuery
  aggregate: (pipeline: unknown[]) => LooseQuery
  create: (doc: unknown) => Promise<unknown>
  collection: {
    insertOne: (doc: object) => Promise<unknown>
    updateOne: (filter: object, update: object) => Promise<unknown>
  }
}

export const loose = (model: unknown): LooseModel => model as LooseModel
