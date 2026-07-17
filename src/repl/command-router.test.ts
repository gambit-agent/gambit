import { expect, test } from 'bun:test'

import { routeCommandInput } from './command-router'

test('routes slash commands as local commands', () => {
  expect(routeCommandInput('/workflow test')).toEqual({
    kind: 'local',
    channel: 'slash',
    name: 'workflow',
    argument: 'test',
    raw: '/workflow test',
  })
})

test('does not route colon-prefixed input as a local command', () => {
  expect(routeCommandInput(':model claude')).toEqual({
    kind: 'prompt',
    value: ':model claude',
  })
})

test('routes /connect as a local-ui command', () => {
  expect(routeCommandInput('/connect openai')).toEqual({
    kind: 'local-ui',
    channel: 'slash',
    name: 'connect',
    argument: 'openai',
    raw: '/connect openai',
  })
})
