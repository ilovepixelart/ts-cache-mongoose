import { execFileSync, spawn } from 'node:child_process'
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseArgs } from 'node:util'
import { MongoMemoryReplSet } from 'mongodb-memory-server'

// End-to-end run of the packed package in a consumer project of its own: every scenario group in
// its own process, through require() and through import, against a real MongoDB replica set and a
// real Redis. The same scenarios run against the published release; a difference fails the run
// unless allowlist.json lists it as an intended change.
//
// Usage: node e2e/run.ts [--candidate <tarball | npm spec>] [--reference <version> | --no-reference]
//                        [--groups a,b] [--keep]
// Env:   REDIS_HOST (default 127.0.0.1) and REDIS_PORT (required);
//        E2E_MONGOOSE / E2E_BSON: the peer versions to install (default: the repo's devDependencies).

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'))
const NAME: string = pkg.name
const REFERENCE_ALIAS = `${NAME}-published`
const FORMATS = { cjs: 'entry.cjs', esm: 'entry.mjs' } as const
const CONCURRENCY = 4
const PROCESS_TIMEOUT_MS = 180_000

type Format = keyof typeof FORMATS
type Result = { name: string; ok: boolean; observed?: unknown; error?: string }
type Outcome = { label: string; format: Format; group: string; results: Result[]; crash?: string }
type AllowlistEntry = { scenario: string; pr: number; change: string }

const { values: args } = parseArgs({
  options: {
    candidate: { type: 'string' },
    reference: { type: 'string' },
    'no-reference': { type: 'boolean', default: false },
    groups: { type: 'string' },
    keep: { type: 'boolean', default: false },
  },
})

const npm = (cwd: string, npmArgs: string[]): string => execFileSync('npm', npmArgs, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'inherit'] })

const installedVersion = (name: string): string => JSON.parse(readFileSync(join(root, 'node_modules', name, 'package.json'), 'utf8')).version

const candidateSpec = (work: string): string => {
  if (args.candidate) return existsSync(args.candidate) ? resolve(args.candidate) : args.candidate
  if (!existsSync(join(root, 'dist'))) throw new Error('dist/ is missing: run npm run build first')
  // npm 11 prints an array of packed packages, npm 12 an object keyed by package name.
  const packed = JSON.parse(npm(root, ['pack', '--json', '--pack-destination', work]))
  const [{ filename }] = Array.isArray(packed) ? packed : Object.values(packed)
  return join(work, filename)
}

const referenceVersion = (): string | undefined => {
  if (args['no-reference']) return undefined
  return args.reference ?? npm(root, ['view', `${NAME}@latest`, 'version']).trim()
}

const createConsumer = (work: string, candidate: string, reference: string | undefined): string => {
  const consumer = join(work, 'consumer')
  mkdirSync(join(consumer, 'tests', 'hydrate'), { recursive: true })
  mkdirSync(join(consumer, 'tests', 'redis'), { recursive: true })
  cpSync(join(root, 'e2e', 'consumer'), join(consumer, 'e2e', 'consumer'), { recursive: true })
  cpSync(join(root, 'tests', 'hydrate', 'observe.ts'), join(consumer, 'tests', 'hydrate', 'observe.ts'))
  cpSync(join(root, 'tests', 'redis', 'tcp.ts'), join(consumer, 'tests', 'redis', 'tcp.ts'))
  writeFileSync(join(consumer, 'package.json'), JSON.stringify({ name: 'e2e-consumer', private: true, type: 'module' }, null, 2))
  const dependencies = [
    candidate,
    process.env.E2E_MONGOOSE || `mongoose@${pkg.devDependencies.mongoose}`,
    process.env.E2E_BSON || `bson@${pkg.devDependencies.bson}`,
    `@nestjs/common@${pkg.devDependencies['@nestjs/common']}`,
    `@nestjs/core@${pkg.devDependencies['@nestjs/core']}`,
    `reflect-metadata@${installedVersion('reflect-metadata')}`,
    `rxjs@${installedVersion('rxjs')}`,
    `ioredis@${pkg.dependencies.ioredis}`,
  ]
  if (reference) dependencies.push(`${REFERENCE_ALIAS}@npm:${NAME}@${reference}`)
  console.log(`Installing into ${consumer}:\n  ${dependencies.join('\n  ')}`)
  npm(consumer, ['install', '--ignore-scripts', '--no-audit', '--no-fund', ...dependencies])
  return consumer
}

const runGroup = (consumer: string, env: Record<string, string>, label: string, format: Format, group: string): Promise<Outcome> => {
  const db = `${label}_${format}_${group}`
  const out = join(consumer, `${db}.json`)
  return new Promise((done) => {
    const child = spawn(process.execPath, [FORMATS[format]], {
      cwd: join(consumer, 'e2e', 'consumer'),
      env: { ...process.env, ...env, E2E_PACKAGE: label === 'candidate' ? NAME : REFERENCE_ALIAS, E2E_GROUP: group, E2E_DB: db, E2E_OUT: out },
      stdio: ['ignore', 'pipe', 'pipe'],
      timeout: PROCESS_TIMEOUT_MS,
    })
    let output = ''
    child.stdout.on('data', (chunk) => (output += chunk))
    child.stderr.on('data', (chunk) => (output += chunk))
    child.on('close', (code, signal) => {
      if (code === 0 && existsSync(out)) {
        done({ label, format, group, results: JSON.parse(readFileSync(out, 'utf8')).results })
        return
      }
      const head = output.trim().split('\n').slice(0, 12).join('\n    ')
      done({ label, format, group, results: [], crash: `exited with ${signal ?? `code ${code}`}\n    ${head}` })
    })
  })
}

const pool = async <T>(tasks: (() => Promise<T>)[], size: number): Promise<T[]> => {
  const results: T[] = []
  let next = 0
  const worker = async () => {
    while (next < tasks.length) {
      const index = next++
      results[index] = await (tasks[index] as () => Promise<T>)()
    }
  }
  await Promise.all(Array.from({ length: size }, worker))
  return results
}

const fingerprint = (result: Result | undefined): string => (result ? JSON.stringify(result.ok ? { ok: true, observed: result.observed } : { ok: false, error: result.error }) : 'missing')

const byScenario = (outcomes: Outcome[], label: string, format: Format): Map<string, Result> => {
  const map = new Map<string, Result>()
  for (const outcome of outcomes.filter((o) => o.label === label && o.format === format)) {
    for (const result of outcome.results) map.set(`${outcome.group}/${result.name}`, result)
  }
  return map
}

const compare = (left: Map<string, Result>, right: Map<string, Result>): string[] => [...new Set([...left.keys(), ...right.keys()])].filter((key) => fingerprint(left.get(key)) !== fingerprint(right.get(key)))

const show = (result: Result | undefined): string => (result ? fingerprint(result).slice(0, 1200) : 'missing')

const report = (outcomes: Outcome[], reference: string | undefined, allowlist: AllowlistEntry[]): string[] => {
  const problems: string[] = []
  for (const outcome of outcomes) {
    if (outcome.crash) problems.push(`CRASH ${outcome.label} ${outcome.group} (${outcome.format}) ${outcome.crash}`)
  }
  for (const format of Object.keys(FORMATS) as Format[]) {
    for (const [key, result] of byScenario(outcomes, 'candidate', format)) {
      if (!result.ok) problems.push(`FAIL ${key} (${format}): ${result.error}`)
    }
  }
  const cjs = byScenario(outcomes, 'candidate', 'cjs')
  const esm = byScenario(outcomes, 'candidate', 'esm')
  for (const key of compare(cjs, esm)) problems.push(`CJS/ESM DIFFER ${key}\n    require: ${show(cjs.get(key))}\n    import:  ${show(esm.get(key))}`)
  if (!reference) return problems

  const allowed = new Set(allowlist.map((entry) => entry.scenario))
  const differing = new Set<string>()
  for (const format of Object.keys(FORMATS) as Format[]) {
    const published = byScenario(outcomes, 'reference', format)
    const candidate = byScenario(outcomes, 'candidate', format)
    for (const key of compare(published, candidate)) {
      differing.add(key)
      if (!allowed.has(key)) problems.push(`DIFFERS FROM ${NAME}@${reference} ${key} (${format})\n    published: ${show(published.get(key))}\n    candidate: ${show(candidate.get(key))}`)
    }
  }
  for (const entry of allowlist) {
    if (!differing.has(entry.scenario)) problems.push(`STALE ALLOWLIST ENTRY ${entry.scenario} (#${entry.pr}): no difference from ${NAME}@${reference}; remove it from e2e/allowlist.json`)
  }
  return problems
}

const main = async (): Promise<number> => {
  const redisPort = process.env.REDIS_PORT
  if (!redisPort) throw new Error('REDIS_PORT is not set: the Redis scenarios need a Redis server (see CONTRIBUTING.md)')
  const work = mkdtempSync(join(tmpdir(), 'ts-cache-mongoose-e2e-'))
  const replSet = await MongoMemoryReplSet.create({ replSet: { count: 1 } })
  try {
    const candidate = candidateSpec(work)
    const reference = referenceVersion()
    const consumer = createConsumer(work, candidate, reference)
    const groupNames = args.groups ? args.groups.split(',') : Object.keys((await import(join(consumer, 'e2e', 'consumer', 'main.ts'))).groups as object)
    const env = { E2E_MONGO_URI: replSet.getUri(), E2E_REDIS_HOST: process.env.REDIS_HOST ?? '127.0.0.1', E2E_REDIS_PORT: redisPort }
    const labels = reference ? ['candidate', 'reference'] : ['candidate']
    const tasks = labels.flatMap((label) => (Object.keys(FORMATS) as Format[]).flatMap((format) => groupNames.map((group) => () => runGroup(consumer, env, label, format, group))))
    const started = Date.now()
    const outcomes = await pool(tasks, CONCURRENCY)
    const allowlist: AllowlistEntry[] = JSON.parse(readFileSync(join(root, 'e2e', 'allowlist.json'), 'utf8')).changes
    const problems = report(outcomes, reference, allowlist)
    const scenarios = byScenario(outcomes, 'candidate', 'cjs').size
    console.log(`\n${candidate} with ${process.env.E2E_MONGOOSE || `mongoose@${pkg.devDependencies.mongoose}`}, Node ${process.version}`)
    console.log(`${groupNames.length} groups, ${scenarios} scenarios, each through require() and import${reference ? `, compared with ${NAME}@${reference}` : ''}, in ${Math.round((Date.now() - started) / 1000)} s`)
    for (const problem of problems) console.log(`\n${problem}`)
    console.log(problems.length === 0 ? '\nE2E PASSED' : `\nE2E FAILED: ${problems.length} problem(s)`)
    return problems.length === 0 ? 0 : 1
  } finally {
    await replSet.stop()
    if (args.keep) console.log(`Kept ${work}`)
    else rmSync(work, { recursive: true, force: true })
  }
}

process.exitCode = await main()
