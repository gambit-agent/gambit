import { expect, test } from 'bun:test'

import { evaluatePermissionMode } from './permission-rules'

test('plan mode never hard-denies execute tools', () => {
  for (const toolId of ['bash', 'executeShell', 'write', 'edit', 'patchFile']) {
    expect(evaluatePermissionMode('Plan', { toolId, subject: toolId })).toBe('ask')
  }
})

test('plan mode runs explorer subagents without prompting', () => {
  expect(evaluatePermissionMode('Plan', { toolId: 'spawnAgent', subject: 'Explore' })).toBe('allow')
  expect(evaluatePermissionMode('Plan', { toolId: 'runAgents', subject: 'Explore' })).toBe('allow')
  expect(evaluatePermissionMode('Plan', { toolId: 'workflow', subject: 'Explore' })).toBe('allow')
})

test('plan mode still allows read-only tools and plan file writes', () => {
  expect(evaluatePermissionMode('Plan', { toolId: 'grep', subject: 'Search' })).toBe('allow')
  expect(
    evaluatePermissionMode('Plan', {
      toolId: 'write',
      subject: 'Write the plan',
      metadata: { isPlanFileWrite: true },
    }),
  ).toBe('allow')
})

test('exitPlanMode asks so the approval overlay can open', () => {
  expect(evaluatePermissionMode('Plan', { toolId: 'exitPlanMode', subject: 'Review plan' })).toBe('ask')
})
