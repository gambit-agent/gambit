import { z } from 'zod'

import { getPlanFilePath, readPlan } from '../plans/plan-store'
import type { ToolDefinition } from './tool-types'

const enterPlanModeSchema = z.object({})

const exitPlanModeSchema = z.object({})

export const enterPlanModeTool: ToolDefinition<typeof enterPlanModeSchema, string> = {
  id: 'enterPlanMode',
  displayName: 'Enter Plan Mode',
  description: [
    'Enter Plan mode for complex tasks requiring exploration and design.',
    'Use this proactively when a task has multiple valid approaches, requires architectural decisions,',
    'or involves multi-file changes. In Plan mode you explore the codebase read-only and write your',
    'Plan to the Plan file using writeFile only. When ready, call exitPlanMode to request user approval.',
  ].join(' '),
  inputSchema: enterPlanModeSchema,
  execute: async (_input, context) => {
    if (!context.permissionEngine) {
      throw new Error('Permission engine is not available.')
    }

    const currentMode = context.permissionEngine.getSnapshot().mode
    if (currentMode === 'Plan') {
      return 'Already in Plan mode. Continue exploring and write your Plan to the Plan file.'
    }

    // Store pre-Plan mode for restoration and switch to Plan
    context.permissionEngine.setPrePlanMode(currentMode)
    context.permissionEngine.setMode('Plan')

    const sessionId = context.sessionId ?? 'default'
    const planFilePath = getPlanFilePath(sessionId)

    return [
      'Entered Plan mode. You are now in a read-only exploration phase.',
      '',
      `Plan file: ${planFilePath}`,
      '',
      'In Plan mode, you should:',
      '1. Thoroughly explore the codebase to understand existing patterns',
      '2. Identify similar features and architectural approaches',
      '3. Consider multiple approaches and their trade-offs',
      '4. Write your implementation Plan to the Plan file using writeFile',
      '5. When ready, call exitPlanMode to present your Plan for user approval',
      '',
      'IMPORTANT: Do NOT write or edit any files except the Plan file.',
      'All write/execute tools are blocked except for writing to the Plan file.',
    ].join('\n')
  },
  summarize: (result) => 'Entered Plan mode',
}

export const exitPlanModeTool: ToolDefinition<typeof exitPlanModeSchema, string> = {
  id: 'exitPlanMode',
  displayName: 'Exit Plan Mode',
  description: [
    'Exit Plan mode and present your Plan for user approval.',
    'Call this only after writing your Plan to the Plan file.',
    'The user will review the Plan and approve or reject it.',
    'If approved, you can proceed with implementation.',
    'If rejected, you will remain in Plan mode to refine your Plan.',
  ].join(' '),
  inputSchema: exitPlanModeSchema,
  getPermissionRequest: () => ({
    subject: 'Exit Plan mode and review Plan',
    metadata: { isPlanApproval: true },
  }),
  execute: async (_input, context) => {
    if (!context.permissionEngine) {
      throw new Error('Permission engine is not available.')
    }

    const currentMode = context.permissionEngine.getSnapshot().mode
    if (currentMode !== 'Plan') {
      return 'You are not in Plan mode. This tool is only for exiting Plan mode after writing a Plan. If your Plan was already approved, continue with implementation.'
    }

    const sessionId = context.sessionId ?? 'default'
    const Plan = await readPlan(sessionId)

    if (!Plan || Plan.trim() === '') {
      const planFilePath = getPlanFilePath(sessionId)
      throw new Error(
        `No Plan file found at ${planFilePath}. Write your Plan to this file before calling exitPlanMode.`,
      )
    }

    // Permission was granted (user approved) — restore previous mode
    const prePlanMode = context.permissionEngine.getPrePlanMode()
    context.permissionEngine.setMode(prePlanMode)
    context.permissionEngine.setPrePlanMode(null)

    const planFilePath = getPlanFilePath(sessionId)

    return [
      'User has approved your Plan. You can now start coding.',
      '',
      `Your Plan has been saved to: ${planFilePath}`,
      'You can refer back to it if needed during implementation.',
      '',
      '## Approved Plan:',
      Plan,
    ].join('\n')
  },
  summarize: (result) => 'Exited Plan mode — Plan approved',
}
