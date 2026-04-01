import { expect, test } from 'bun:test'

import { formatCompactToolSummary, formatToolEvent } from './toolSummaries'

test('summarizes file reads without showing file contents', () => {
  const summary = formatToolEvent({
    toolName: 'readFile',
    status: 'completed',
    args: { path: 'src/App.tsx' },
    result: 'const answer = 42',
  })

  expect(summary).toBe('Read file\nsrc/App.tsx · 17 chars · 1 line')
  expect(summary).not.toContain('const answer = 42')
})

test('summarizes shell results without dumping stdout and stderr', () => {
  const summary = formatToolEvent({
    toolName: 'executeShell',
    status: 'completed',
    args: { command: 'git status --short' },
    result: 'exit_code: 0\n\nstdout:\nM src/App.tsx\n\nstderr: <empty>',
  })

  expect(summary).toBe('Command completed · exit 0\ngit status --short')
  expect(summary).not.toContain('stdout')
  expect(summary).not.toContain('stderr')
})

test('formats compact tool summaries on a single line', () => {
  const summary = formatCompactToolSummary({
    toolName: 'readFile',
    status: 'completed',
    args: { path: 'README.md' },
    result: '# Gambit\n\nTerminal app\n',
  })

  expect(summary).toBe('Read file · README.md · 23 chars · 4 lines')
  expect(summary).not.toContain('\n')
})
