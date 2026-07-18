import { afterEach, beforeEach, expect, test } from 'bun:test'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'

import { setWorkspaceRootForTesting, workspaceRoot as originalWorkspaceRoot } from '../config'
import {
  builtinSystemPrompt,
  loadSystemPrompt,
  loadSystemPromptDetailed,
  WORKSPACE_PROMPT_SECTION_HEADER,
} from './prompt'

let tempRoot: string

beforeEach(async () => {
  tempRoot = await mkdtemp(path.join(tmpdir(), 'gambit-prompt-'))
  setWorkspaceRootForTesting(tempRoot)
})

afterEach(async () => {
  setWorkspaceRootForTesting(originalWorkspaceRoot)
  await rm(tempRoot, { recursive: true, force: true })
})

test('built-in prompt is the embedded canonical system.prompt.md', async () => {
  const canonical = (await Bun.file(path.join(import.meta.dir, '../../system.prompt.md')).text()).trim()
  expect(builtinSystemPrompt).toBe(canonical)
  expect(builtinSystemPrompt).toContain('You are Gambit, an AI coding agent running in the Gambit CLI')
})

test('default system prompt covers core orchestration features without a workspace override', async () => {
  const notices: string[] = []
  const prompt = await loadSystemPrompt({ notify: (message) => notices.push(message) })

  expect(prompt).toBe(builtinSystemPrompt)
  expect(prompt).toContain('`glob`')
  expect(prompt).toContain('`grep`')
  expect(prompt).toContain('`edit`')
  expect(prompt).toContain('`patchFile`')
  expect(prompt).toContain('`bash`')
  expect(notices).toEqual([])
})

test('workspace system.prompt.md is appended to the built-in prompt, not a replacement', async () => {
  await writeFile(path.join(tempRoot, 'system.prompt.md'), 'Custom workspace instructions', 'utf8')

  const notices: string[] = []
  const prompt = await loadSystemPrompt({ notify: (message) => notices.push(message) })

  expect(prompt.startsWith(builtinSystemPrompt)).toBe(true)
  expect(prompt).toContain(WORKSPACE_PROMPT_SECTION_HEADER)
  expect(prompt).toContain('Custom workspace instructions')
  expect(prompt.indexOf(WORKSPACE_PROMPT_SECTION_HEADER)).toBeGreaterThan(
    prompt.indexOf('You are Gambit'),
  )
  expect(notices).toHaveLength(1)
  expect(notices[0]).toContain('system prompt overrides')
  expect(notices[0]).toContain(path.join(tempRoot, 'system.prompt.md'))
})

test('workspace copy identical to the built-in prompt is not appended twice', async () => {
  await writeFile(path.join(tempRoot, 'system.prompt.md'), `${builtinSystemPrompt}\n`, 'utf8')

  const notices: string[] = []
  const { prompt, workspaceOverride } = await loadSystemPromptDetailed({
    notify: (message) => notices.push(message),
  })

  expect(prompt).toBe(builtinSystemPrompt)
  expect(workspaceOverride).toBeNull()
  expect(notices).toEqual([])
})

test('near-identical workspace copy (version skew) is not appended twice', async () => {
  // Same first line, small edit, length well within 10% of the built-in.
  const skewedCopy = `${builtinSystemPrompt}\n\nMinor trailing addition from a newer checkout.`
  await writeFile(path.join(tempRoot, 'system.prompt.md'), skewedCopy, 'utf8')

  const notices: string[] = []
  const { prompt, workspaceOverride } = await loadSystemPromptDetailed({
    notify: (message) => notices.push(message),
  })

  expect(prompt).toBe(builtinSystemPrompt)
  expect(workspaceOverride).toBeNull()
  expect(notices).toEqual([])
})

test('frontmatter mode: replace uses only the workspace prompt body', async () => {
  await writeFile(
    path.join(tempRoot, 'system.prompt.md'),
    '---\nmode: replace\n---\nYou are a fully custom agent.',
    'utf8',
  )

  const notices: string[] = []
  const { prompt, workspaceOverride } = await loadSystemPromptDetailed({
    notify: (message) => notices.push(message),
  })

  expect(prompt).toBe('You are a fully custom agent.')
  expect(prompt).not.toContain('You are Gambit')
  expect(prompt).not.toContain(WORKSPACE_PROMPT_SECTION_HEADER)
  expect(workspaceOverride).toBe('replace')
  expect(notices).toHaveLength(1)
  expect(notices[0]).toContain('replacing the built-in system prompt')
})

test('frontmatter mode: append keeps append semantics and strips the frontmatter', async () => {
  await writeFile(
    path.join(tempRoot, 'system.prompt.md'),
    '---\nmode: append\n---\nExtra workspace rules.',
    'utf8',
  )

  const notices: string[] = []
  const { prompt, workspaceOverride } = await loadSystemPromptDetailed({
    notify: (message) => notices.push(message),
  })

  expect(prompt.startsWith(builtinSystemPrompt)).toBe(true)
  expect(prompt).toContain(WORKSPACE_PROMPT_SECTION_HEADER)
  expect(prompt).toContain('Extra workspace rules.')
  expect(prompt).not.toContain('mode: append')
  expect(workspaceOverride).toBe('append')
  expect(notices).toHaveLength(1)
})

test('replace frontmatter with an empty body falls back to the built-in prompt', async () => {
  await writeFile(path.join(tempRoot, 'system.prompt.md'), '---\nmode: replace\n---\n   \n', 'utf8')

  const notices: string[] = []
  const { prompt, workspaceOverride } = await loadSystemPromptDetailed({
    notify: (message) => notices.push(message),
  })

  expect(prompt).toBe(builtinSystemPrompt)
  expect(workspaceOverride).toBeNull()
  expect(notices).toEqual([])
})

test('loadSystemPromptDetailed reports no override without a workspace file', async () => {
  const { prompt, workspaceOverride } = await loadSystemPromptDetailed({ notify: () => {} })
  expect(prompt).toBe(builtinSystemPrompt)
  expect(workspaceOverride).toBeNull()
})

test('empty workspace system.prompt.md keeps the built-in prompt', async () => {
  await writeFile(path.join(tempRoot, 'system.prompt.md'), '   \n', 'utf8')

  const notices: string[] = []
  const prompt = await loadSystemPrompt({ notify: (message) => notices.push(message) })

  expect(prompt).toBe(builtinSystemPrompt)
  expect(notices).toEqual([])
})
