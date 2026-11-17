import { describe, expect, it } from 'vitest'

import { toExportAssignment, toRequireImport } from '../scripts/cjs-export-types'

describe('toExportAssignment', () => {
  it('should replace the default export with export = and keep named types reachable through a namespace', () => {
    const input = ['type Duration = number;', 'declare class CacheMongoose {', '}', '', 'export { CacheMongoose as default };', 'export type { CacheOptions, Duration };', '//# sourceMappingURL=index.d.cts.map', ''].join('\n')
    const expected = [
      'type Duration = number;',
      'declare class CacheMongoose {',
      '}',
      '',
      'type _CacheOptions = CacheOptions;',
      'type _Duration = Duration;',
      'declare namespace CacheMongoose {',
      '    export type CacheOptions = _CacheOptions;',
      '    export type Duration = _Duration;',
      '}',
      'export = CacheMongoose;',
      '//# sourceMappingURL=index.d.cts.map',
      '',
    ].join('\n')
    expect(toExportAssignment(input)).toBe(expected)
  })

  it('should emit export = without a namespace when there are no named types', () => {
    expect(toExportAssignment('declare class A {\n}\nexport { A as default };\n')).toBe('declare class A {\n}\nexport = A;\n')
  })

  it('should reject declarations without a default export', () => {
    expect(() => toExportAssignment('declare class A {\n}\nexport { A };\n')).toThrow('Expected "export { X as default };" in the CommonJS declarations')
  })

  it('should reject declarations that also export values, since export = cannot carry them', () => {
    expect(() => toExportAssignment('declare const b: 1;\nexport { A as default };\nexport { b };\n')).toThrow('Cannot use "export =" alongside other exports: export { b };')
  })
})

describe('toRequireImport', () => {
  it('should turn a default import with named types into import = require and type aliases', () => {
    const input = ["import { Type } from '@nestjs/common';", "import CacheMongoose, { CacheOptions } from '../index.cjs';", "import 'mongoose';", ''].join('\n')
    const expected = ["import { Type } from '@nestjs/common';", "import CacheMongoose = require('../index.cjs');", 'type CacheOptions = CacheMongoose.CacheOptions;', "import 'mongoose';", ''].join('\n')
    expect(toRequireImport(input, '../index.cjs')).toBe(expected)
  })

  it('should rewrite a default import without named types', () => {
    expect(toRequireImport("import A from './a.cjs';\n", './a.cjs')).toBe("import A = require('./a.cjs');\n")
  })

  it('should leave imports from other modules untouched', () => {
    const input = "import Other from 'other';\nimport A from './a.cjs';\n"
    expect(toRequireImport(input, './a.cjs')).toBe("import Other from 'other';\nimport A = require('./a.cjs');\n")
  })

  it('should reject a renamed named import', () => {
    expect(() => toRequireImport("import A, { B as C } from './a.cjs';\n", './a.cjs')).toThrow('Cannot rewrite the renamed import "B as C" from ./a.cjs')
  })

  it('should reject declarations that do not import the entry', () => {
    expect(() => toRequireImport("import A from './b.cjs';\n", './a.cjs')).toThrow("Expected a default import from './a.cjs'")
  })
})
