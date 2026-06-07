import { expect, test } from 'bun:test'

import { routeCommandInput } from './command-router'

test('routes slash commands as local commands', () => {
  expect(routeCommandInput('/key token')).toEqual({
    kind: 'local',
    channel: 'slash',
    name: 'key',
    argument: 'token',
    raw: '/key token',
  })
})

test('does not route colon-prefixed input as a local command', () => {
  expect(routeCommandInput(':key token')).toEqual({
    kind: 'prompt',
    value: ':key token',
  })
})
