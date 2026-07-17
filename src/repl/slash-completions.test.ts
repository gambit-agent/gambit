import { expect, test } from 'bun:test'

import type { SkillDefinition } from '../lib/skills'
import type { SlashCommandDefinition } from '../lib/slashCommands'
import {
  findActiveSlashCompletion,
  getSlashCompletionMatchesFromCatalog,
  replaceActiveSlashCompletion,
} from './slash-completions'

function command(overrides: Partial<SlashCommandDefinition>): SlashCommandDefinition {
  return {
    id: 'review',
    name: 'review',
    namespace: null,
    scope: 'project',
    description: 'Review changes',
    allowedTools: [],
    disableModelInvocation: false,
    filePath: '/tmp/review.md',
    relativePath: '.gambit/commands/review.md',
    body: 'Review',
    ...overrides,
  }
}

function skill(overrides: Partial<SkillDefinition>): SkillDefinition {
  return {
    name: 'opentui',
    description: 'Build terminal user interfaces.',
    scope: 'project',
    filePath: '/tmp/opentui/SKILL.md',
    directoryPath: '/tmp/opentui',
    body: 'Skill body',
    ...overrides,
  }
}

test('finds the active slash command at the composer start', () => {
  expect(findActiveSlashCompletion('/he', '/he'.length)).toEqual({
    start: 0,
    end: 3,
    query: 'he',
    mode: 'command',
  })
  expect(findActiveSlashCompletion('  /front/re', '  /front/re'.length)).toEqual({
    start: 2,
    end: 11,
    query: 'front/re',
    mode: 'command',
  })
  expect(findActiveSlashCompletion('explain /help', 'explain /help'.length)).toBeNull()
})

test('finds the active skill argument for /skill', () => {
  expect(findActiveSlashCompletion('/skill open', '/skill open'.length)).toEqual({
    start: 7,
    end: 11,
    query: 'open',
    mode: 'skill',
  })
  expect(findActiveSlashCompletion('/skill opentui now', '/skill opentui now'.length)).toBeNull()
})

test('lists built-ins, custom commands, and skills', () => {
  const matches = getSlashCompletionMatchesFromCatalog(
    'review',
    'command',
    [command({ id: 'frontend/review', name: 'review', namespace: 'frontend' })],
    [skill({ name: 'reviewer', description: 'Review code with strict standards.' })],
  )

  expect(matches.map((match) => match.label)).toContain('/frontend/review')
  expect(matches.map((match) => match.label)).toContain('/skill reviewer')
})

test('lists moved colon commands as slash built-ins', () => {
  const matches = getSlashCompletionMatchesFromCatalog('mcp', 'command', [], [])

  expect(matches.map((match) => match.label)).toContain('/mcp')
})

test('replaces a slash token with a skill trigger command', () => {
  const completion = findActiveSlashCompletion('/opentui', '/opentui'.length)
  expect(completion).not.toBeNull()

  const [match] = getSlashCompletionMatchesFromCatalog(
    'opentui',
    'command',
    [],
    [skill({ name: 'opentui' })],
  )

  const result = replaceActiveSlashCompletion('/opentui', completion!, match!)
  expect(result.value).toBe('/skill opentui ')
  expect(result.cursorOffset).toBe(result.value.length)
})

test('replaces the skill argument inside /skill', () => {
  const completion = findActiveSlashCompletion('/skill open', '/skill open'.length)
  expect(completion).not.toBeNull()

  const [match] = getSlashCompletionMatchesFromCatalog(
    'open',
    'skill',
    [],
    [skill({ name: 'opentui' })],
  )

  const result = replaceActiveSlashCompletion('/skill open', completion!, match!)
  expect(result.value).toBe('/skill opentui ')
  expect(result.cursorOffset).toBe(result.value.length)
})
