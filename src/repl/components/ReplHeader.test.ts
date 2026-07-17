import { expect, test } from 'bun:test'

import { formatHeaderWorkspacePath } from './ReplHeader'

test('formats workspace paths under the home directory with a tilde prefix', () => {
  expect(formatHeaderWorkspacePath('/home/sergio/DEV/opentui/gambit', '/home/sergio')).toBe('~/DEV/opentui/gambit')
})

test('formats the home directory itself as a tilde', () => {
  expect(formatHeaderWorkspacePath('/home/sergio', '/home/sergio')).toBe('~')
})

test('leaves paths outside the home directory absolute', () => {
  expect(formatHeaderWorkspacePath('/opt/gambit', '/home/sergio')).toBe('/opt/gambit')
})
