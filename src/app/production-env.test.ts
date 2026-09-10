import { describe, expect, test } from 'bun:test'

import { ensureProductionEnv } from './production-env'

describe('ensureProductionEnv', () => {
  test('defaults an unset NODE_ENV to production', () => {
    const env: { NODE_ENV?: string } = {}
    ensureProductionEnv(env)
    expect(env.NODE_ENV).toBe('production')
  })

  test('treats an empty NODE_ENV as unset', () => {
    const env: { NODE_ENV?: string } = { NODE_ENV: '' }
    ensureProductionEnv(env)
    expect(env.NODE_ENV).toBe('production')
  })

  test('keeps an explicit NODE_ENV', () => {
    for (const value of ['development', 'test', 'staging']) {
      const env: { NODE_ENV?: string } = { NODE_ENV: value }
      ensureProductionEnv(env)
      expect(env.NODE_ENV).toBe(value)
    }
  })

  test('importing the module never overrides the test runner environment', () => {
    // bun test sets NODE_ENV=test before any module loads; the import at the
    // top of this file must have left it untouched.
    expect(process.env.NODE_ENV).toBe('test')
  })
})
