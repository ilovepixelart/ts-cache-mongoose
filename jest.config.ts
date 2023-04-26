// For a detailed explanation regarding each configuration property, visit:
// https://jestjs.io/docs/en/configuration.html
import { recursive } from 'merge'
import mongo from '@shelf/jest-mongodb/jest-preset'

const config = recursive(mongo, {
  roots: [
    '<rootDir>/src/',
    '<rootDir>/tests/'
  ],
  clearMocks: true,
  collectCoverage: true,
  collectCoverageFrom: [
    'src/**/*.ts',
    '!src/**/*.d.ts',
    '!src/interfaces/**/*.ts'
  ],
  coverageDirectory: 'coverage',
  testMatch: [
    '<rootDir>/tests/**/*.test.ts'
  ],
  transform: {
    '^.+\\.(t|j)sx?$': '@swc/jest'
  },
  testPathIgnorePatterns: [
    'node_modules'
  ],
  watchPathIgnorePatterns: [
    'globalConfig'
  ]
})

export default config
