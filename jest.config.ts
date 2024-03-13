/* eslint-disable @typescript-eslint/no-var-requires */
const { recursive } = require('merge')
const mongo = require('@shelf/jest-mongodb/jest-preset')

const config = recursive(mongo, {
  roots: [
    '<rootDir>/src/',
    '<rootDir>/tests/',
  ],
  clearMocks: true,
  collectCoverage: true,
  collectCoverageFrom: [
    'src/**/*.ts',
    '!src/**/*.d.ts',
    '!src/interfaces/**/*.ts',
  ],
  coverageDirectory: 'coverage',
  testMatch: [
    '<rootDir>/tests/**/*.test.ts',
  ],
  transform: {
    '^.+\\.(t|j)sx?$': '@swc/jest',
  },
  testPathIgnorePatterns: [
    'node_modules',
  ],
  watchPathIgnorePatterns: [
    'globalConfig',
  ],
})

module.exports = config
