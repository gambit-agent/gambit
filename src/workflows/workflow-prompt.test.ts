import { expect, test } from 'bun:test'

import { buildWorkflowEditPrompt, buildWorkflowRunPrompt } from './workflow-prompt'

test('buildWorkflowRunPrompt instructs the model to use the workflow tool', () => {
  const prompt = buildWorkflowRunPrompt('verify the migration plan')

  expect(prompt).toContain('Workflow task: verify the migration plan')
  expect(prompt).toContain('using the workflow tool')
  expect(prompt).toContain('agent(prompt, options)')
})

test('buildWorkflowRunPrompt rejects empty tasks', () => {
  expect(() => buildWorkflowRunPrompt('   ')).toThrow('Workflow task must not be empty')
})

test('buildWorkflowEditPrompt includes the prior script and requested change', () => {
  const prompt = buildWorkflowEditPrompt(
    "export const meta = { name: 'demo', description: 'demo' }\nreturn await agent('inspect')",
    'add a reviewer',
  )

  expect(prompt).toContain('Workflow edit request: add a reviewer')
  expect(prompt).toContain('Previous workflow script:')
  expect(prompt).toContain("export const meta = { name: 'demo'")
})
