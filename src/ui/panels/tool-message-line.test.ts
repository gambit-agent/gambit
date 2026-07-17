import { expect, test } from 'bun:test'

import type { ConversationMessage } from '../../conversation/conversation-types'
import { formatToolMessageLine, formatToolMessagePresentation, toolMessageRunningFrames } from './tool-message-line'

function createToolMessage(
  status: 'started' | 'completed' | 'failed',
  metadata: NonNullable<ConversationMessage['metadata']> = {},
): ConversationMessage {
  return {
    id: 'tool-1',
    role: 'tool',
    content: '',
    timestamp: '2026-04-01T12:00:00.000Z',
    metadata: {
      toolName: 'executeShell',
      toolArgs: { command: 'echo hello' },
      toolStatus: status,
      ...metadata,
    },
  }
}

test('formats running tool messages with a tool-specific prefix', () => {
  const line = formatToolMessageLine(createToolMessage('started'), 1)

  expect(line.indicator).toBe(toolMessageRunningFrames[1])
  expect(line.text).toBe('• Ran echo hello')
})

test('omits the animated indicator once the tool finishes', () => {
  const line = formatToolMessageLine(createToolMessage('completed'), 2)

  expect(line.indicator).toBeNull()
  expect(line.text).toBe('• Ran echo hello')
})

test('uses varied action verbs based on the tool name', () => {
  expect(
    formatToolMessageLine(createToolMessage('completed', { toolName: 'readFile', toolArgs: { path: 'src/index.tsx' } })).text,
  ).toBe('• Explored')
  expect(
    formatToolMessageLine(createToolMessage('started', { toolName: 'searchFiles', toolArgs: { pattern: 'TODO' } })).text,
  ).toBe('• Explored')
  expect(
    formatToolMessageLine(createToolMessage('completed', { toolName: 'patchFile', toolArgs: { path: 'src/index.tsx' } })).text,
  ).toStartWith('• Edited')
  expect(
    formatToolMessageLine(createToolMessage('completed', { toolName: 'listTasks', toolArgs: {} })).text,
  ).toBe('• Explored')
  expect(
    formatToolMessageLine(createToolMessage('started', { toolName: 'waitForTasks', toolArgs: { taskIds: ['a'] } })).text,
  ).toBe('• Explored')
  expect(
    formatToolMessageLine(
      createToolMessage('started', {
        toolName: 'runAgents',
        toolArgs: { agents: [{ role: 'explorer', prompt: 'inspect' }] },
      }),
    ).text,
  ).toStartWith('• Delegated')
})

test('formats read tools as explored tree entries', () => {
  const presentation = formatToolMessagePresentation(
    createToolMessage('completed', { toolName: 'readFile', toolArgs: { path: 'REFERENCE.md' } }),
  )

  expect(presentation.heading).toBe('Explored')
  expect(presentation.detailLines).toEqual([{ text: '  └ Read REFERENCE.md', kind: 'normal' }])
})

test('formats skill activation without dumping the skill body', () => {
  const presentation = formatToolMessagePresentation(
    createToolMessage('completed', {
      toolName: 'activateSkill',
      toolArgs: { name: 'opentui' },
      toolResult: [
        '<skill_content name="opentui" scope="project">',
        '# OpenTUI Platform Skill',
        'Very long instructions.',
        '',
        'Skill directory: /home/sergio/.agents/skills/opentui',
        '</skill_content>',
      ].join('\n'),
    }),
  )

  expect(presentation.heading).toBe('Activated skill · opentui')
  expect(presentation.detailLines).toEqual([{ text: '  └ /home/sergio/.agents/skills/opentui', kind: 'normal' }])
  expect(JSON.stringify(presentation)).not.toContain('Very long instructions')
})

test('formats edited file diffs with counts and a compact changed-line preview', () => {
  const presentation = formatToolMessagePresentation(
    createToolMessage('completed', {
      toolName: 'patchFile',
      toolArgs: {
        patch: [
          'diff --git a/src/repl/components/ReplHeader.tsx b/src/repl/components/ReplHeader.tsx',
          '--- a/src/repl/components/ReplHeader.tsx',
          '+++ b/src/repl/components/ReplHeader.tsx',
          '@@ -12,2 +12,3 @@',
          '       alignItems="center"',
          '+      paddingTop={1}',
          '       paddingBottom={1}',
          '',
        ].join('\n'),
      },
    }),
  )

  expect(presentation.heading).toBe('Edited src/repl/components/ReplHeader.tsx (+1 -0)')
  expect(presentation.detailLines).toEqual([
    { text: '    12        alignItems="center"', kind: 'context' },
    { text: '    13 +      paddingTop={1}', kind: 'added' },
    { text: '    14        paddingBottom={1}', kind: 'context' },
  ])
})

test('does not render failed patch inputs as completed edits', () => {
  const presentation = formatToolMessagePresentation(
    createToolMessage('failed', {
      toolName: 'patchFile',
      toolArgs: {
        patch: [
          'diff --git a/src/index.tsx b/src/index.tsx',
          '--- a/src/index.tsx',
          '+++ b/src/index.tsx',
          '@@ -1,1 +1,1 @@',
          '-old',
          '+new',
          '',
        ].join('\n'),
      },
      toolResult: 'Patch failed.',
    }),
  )

  expect(presentation.heading).toBe('patchFile failed')
  expect(presentation.detailLines).toEqual([{ text: '  └ Patch failed.', kind: 'normal' }])
})
