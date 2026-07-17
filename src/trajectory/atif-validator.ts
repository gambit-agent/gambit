import type { AtifStep, AtifTrajectory } from './atif-types'

export interface AtifValidationIssue {
  path: string
  message: string
}

export class AtifValidationError extends Error {
  constructor(readonly issues: AtifValidationIssue[]) {
    super(`Invalid ATIF trajectory:\n${issues.map((issue) => `${issue.path}: ${issue.message}`).join('\n')}`)
    this.name = 'AtifValidationError'
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function hasText(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0
}

function validateStep(step: AtifStep, index: number, issues: AtifValidationIssue[], path: string): void {
  const expectedStepId = index + 1
  if (step.step_id !== expectedStepId) {
    issues.push({ path: `${path}.step_id`, message: `must be sequential starting at 1; expected ${expectedStepId}` })
  }
  if (step.source !== 'system' && step.source !== 'user' && step.source !== 'agent') {
    issues.push({ path: `${path}.source`, message: 'must be one of system, user, or agent' })
  }
  if (step.message === undefined) {
    issues.push({ path: `${path}.message`, message: 'is required, but may be an empty string' })
  }

  const toolCallIds = new Set<string>()
  for (const [toolIndex, call] of (step.tool_calls ?? []).entries()) {
    const callPath = `${path}.tool_calls[${toolIndex}]`
    if (!hasText(call.tool_call_id)) {
      issues.push({ path: `${callPath}.tool_call_id`, message: 'is required' })
    } else if (toolCallIds.has(call.tool_call_id)) {
      issues.push({ path: `${callPath}.tool_call_id`, message: 'must be unique within the step' })
    } else {
      toolCallIds.add(call.tool_call_id)
    }
    if (!hasText(call.function_name)) {
      issues.push({ path: `${callPath}.function_name`, message: 'is required' })
    }
    if (!isRecord(call.arguments)) {
      issues.push({ path: `${callPath}.arguments`, message: 'must be a JSON object' })
    }
  }

  for (const [resultIndex, result] of (step.observation?.results ?? []).entries()) {
    const resultPath = `${path}.observation.results[${resultIndex}]`
    if (result.source_call_id && !toolCallIds.has(result.source_call_id)) {
      issues.push({ path: `${resultPath}.source_call_id`, message: 'must match a tool_call_id in the same step' })
    }
    for (const [refIndex, ref] of (result.subagent_trajectory_ref ?? []).entries()) {
      if (!ref.trajectory_id && !ref.trajectory_path) {
        issues.push({
          path: `${resultPath}.subagent_trajectory_ref[${refIndex}]`,
          message: 'must set trajectory_id or trajectory_path',
        })
      }
    }
  }
}

function validateTrajectoryInner(trajectory: AtifTrajectory, issues: AtifValidationIssue[], path: string): void {
  if (!hasText(trajectory.schema_version)) {
    issues.push({ path: `${path}.schema_version`, message: 'is required' })
  }
  if (!isRecord(trajectory.agent)) {
    issues.push({ path: `${path}.agent`, message: 'is required' })
  } else {
    if (!hasText(trajectory.agent.name)) {
      issues.push({ path: `${path}.agent.name`, message: 'is required' })
    }
    if (!hasText(trajectory.agent.version)) {
      issues.push({ path: `${path}.agent.version`, message: 'is required' })
    }
  }
  if (!Array.isArray(trajectory.steps)) {
    issues.push({ path: `${path}.steps`, message: 'is required and must be an array' })
    return
  }

  trajectory.steps.forEach((step, index) => validateStep(step, index, issues, `${path}.steps[${index}]`))

  const embeddedIds = new Set<string>()
  for (const [index, subagent] of (trajectory.subagent_trajectories ?? []).entries()) {
    const subagentPath = `${path}.subagent_trajectories[${index}]`
    if (!hasText(subagent.trajectory_id)) {
      issues.push({ path: `${subagentPath}.trajectory_id`, message: 'is required for embedded subagents' })
    } else if (embeddedIds.has(subagent.trajectory_id)) {
      issues.push({ path: `${subagentPath}.trajectory_id`, message: 'must be unique within subagent_trajectories' })
    } else {
      embeddedIds.add(subagent.trajectory_id)
    }
    validateTrajectoryInner(subagent, issues, subagentPath)
  }
}

export function validateAtifTrajectory(trajectory: AtifTrajectory): AtifValidationIssue[] {
  const issues: AtifValidationIssue[] = []
  validateTrajectoryInner(trajectory, issues, '$')
  return issues
}

export function assertValidAtifTrajectory(trajectory: AtifTrajectory): void {
  const issues = validateAtifTrajectory(trajectory)
  if (issues.length > 0) {
    throw new AtifValidationError(issues)
  }
}
