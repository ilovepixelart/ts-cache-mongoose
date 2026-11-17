import { readFileSync, writeFileSync } from 'node:fs'
import { dirname, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const DEFAULT_EXPORT = /^export \{ (\w+) as default \};\n/m
const TYPE_EXPORTS = /^export type \{ ([\w, ]+) \};\n/m
const IMPORT = /^import (\w+)(?:, \{ ([^}]*) \})? from '([^']+)';$/gm

// Rollup emits `module.exports = X` for a CommonJS entry whose only runtime export is the default,
// but the bundled declarations keep `export { X as default }`, which tells CommonJS TypeScript
// consumers to read a `.default` that does not exist. Rewrite them to `export =` with the named
// types moved into a namespace merged with X.
export const toExportAssignment = (declarations: string): string => {
  const name = DEFAULT_EXPORT.exec(declarations)?.[1]
  if (!name) {
    throw new Error('Expected "export { X as default };" in the CommonJS declarations')
  }

  const typeNames = TYPE_EXPORTS.exec(declarations)?.[1]?.split(', ') ?? []
  const aliases = typeNames.map((type) => `type _${type} = ${type};\n`).join('')
  const members = typeNames.map((type) => `    export type ${type} = _${type};\n`).join('')
  const namespace = typeNames.length > 0 ? `declare namespace ${name} {\n${members}}\n` : ''

  const result = declarations.replace(TYPE_EXPORTS, '').replace(DEFAULT_EXPORT, `${aliases}${namespace}export = ${name};\n`)
  const leftover = result.split('\n').find((line) => line.startsWith('export ') && line !== `export = ${name};`)
  if (leftover) {
    throw new Error(`Cannot use "export =" alongside other exports: ${leftover}`)
  }

  return result
}

// A default import of an `export =` module needs esModuleInterop in the consumer, so declarations
// that import the rewritten entry switch to `import X = require(...)`, which works without it.
export const toRequireImport = (declarations: string, specifier: string): string => {
  let found = false
  const result = declarations.replaceAll(IMPORT, (statement, name: string, named: string | undefined, from: string) => {
    if (from !== specifier) return statement
    found = true
    const types = named ? named.split(', ') : []
    const renamed = types.find((type) => !/^\w+$/.test(type))
    if (renamed) {
      throw new Error(`Cannot rewrite the renamed import "${renamed}" from ${specifier}`)
    }
    return [`import ${name} = require('${specifier}');`, ...types.map((type) => `type ${type} = ${name}.${type};`)].join('\n')
  })
  if (!found) {
    throw new Error(`Expected a default import from '${specifier}'`)
  }

  return result
}

const toSpecifier = (importer: string, target: string): string => {
  const path = relative(dirname(importer), target).replace(/\.d\.cts$/, '.cjs')
  return path.startsWith('.') ? path : `./${path}`
}

// Usage: cjs-export-types.ts <entry.d.cts> [<declarations importing the entry>...]
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [target, ...importers] = process.argv.slice(2)
  if (!target) {
    throw new Error('Usage: cjs-export-types.ts <entry.d.cts> [<importer.d.cts>...]')
  }
  writeFileSync(target, toExportAssignment(readFileSync(target, 'utf8')))
  for (const importer of importers) {
    writeFileSync(importer, toRequireImport(readFileSync(importer, 'utf8'), toSpecifier(importer, target)))
  }
}
