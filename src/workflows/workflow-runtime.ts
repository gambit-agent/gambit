import vm from 'node:vm'

import type { AgentRole } from '../agents/agent-types'
import { parseWorkflowScript } from './workflow-parser'
import type {
  JsonSchema,
  WorkflowAgentOptions,
  WorkflowRunOptions,
  WorkflowRunResult,
} from './workflow-types'

interface RuntimeState {
  currentPhase?: string
  logs: string[]
  phases: string[]
  agentCount: number
  spent: number
}

const MAX_WORKFLOW_CONCURRENCY = 16
const DEFAULT_WORKFLOW_EXECUTION_TIMEOUT_MS = 1000
const AGENT_ROLES: readonly AgentRole[] = ['default', 'explorer', 'worker']

export async function runWorkflow<T = unknown>(
  script: string,
  options: WorkflowRunOptions,
): Promise<WorkflowRunResult<T>> {
  const started = Date.now()
  const { meta, body } = parseWorkflowScript(script)
  const state: RuntimeState = { logs: [], phases: [], agentCount: 0, spent: 0 }
  const concurrency = normalizeConcurrency(options.concurrency)
  const limiter = createLimiter(concurrency)
  const pendingAgentRuns = new Set<Promise<unknown>>()

  const log = (message: unknown) => {
    const text = String(message)
    state.logs.push(text)
    options.onLog?.(text)
  }

  const phase = (title: unknown) => {
    const text = requireString(title, 'phase title')
    state.currentPhase = text
    if (!state.phases.includes(text)) {
      state.phases.push(text)
    }
    options.onPhase?.(text)
  }

  const budget = Object.freeze({
    total: options.tokenBudget ?? null,
    spent: () => state.spent,
    remaining: () => (options.tokenBudget == null ? Infinity : Math.max(0, options.tokenBudget - state.spent)),
  })

  const throwIfAborted = () => {
    if (options.signal?.aborted) {
      throw new Error('workflow aborted')
    }
  }

  const agent = async (prompt: unknown, agentOptions: unknown = {}) => {
    throwIfAborted()
    if (budget.total !== null && budget.remaining() <= 0) {
      throw new Error('workflow token budget exhausted')
    }
    const taskPrompt = requireString(prompt, 'agent prompt')
    const normalizedOptions = normalizeAgentOptions(agentOptions)
    const assignedPhase = normalizedOptions.phase ?? state.currentPhase
    const requestedLabel = normalizedOptions.label?.trim()
    const role = normalizeAgentRole(normalizedOptions)

    const run = limiter(async () => {
      state.agentCount++
      const label = requestedLabel || defaultAgentLabel(assignedPhase, state.agentCount)
      options.onAgentStart?.({ label, phase: assignedPhase, prompt: taskPrompt })
      try {
        throwIfAborted()
        const result = await options.agent.run(taskPrompt, {
          label,
          phase: assignedPhase,
          role,
          schema: normalizedOptions.schema,
          modelId: normalizedOptions.model,
          instructions: buildAgentInstructions(assignedPhase, normalizedOptions),
          signal: options.signal,
        })
        throwIfAborted()
        state.spent += estimateTokens(result)
        options.onAgentEnd?.({ label, phase: assignedPhase, result })
        return result
      } catch (error) {
        if (options.signal?.aborted) {
          throw error
        }
        log(`agent ${label} failed: ${error instanceof Error ? error.message : String(error)}`)
        options.onAgentEnd?.({ label, phase: assignedPhase, result: null })
        return null
      }
    })

    pendingAgentRuns.add(run)
    run.then(
      () => pendingAgentRuns.delete(run),
      () => pendingAgentRuns.delete(run),
    )
    return run
  }

  const parallel = async (thunks: Array<() => Promise<unknown>>) => {
    throwIfAborted()
    if (!Array.isArray(thunks)) {
      throw new TypeError('parallel() expects an array of functions')
    }
    if (thunks.some((thunk) => typeof thunk !== 'function')) {
      throw new TypeError('parallel() expects an array of functions, not promises. Wrap each call: () => agent(...)')
    }
    return Promise.all(
      thunks.map(async (thunk, index) => {
        try {
          return await thunk()
        } catch (error) {
          if (options.signal?.aborted) {
            throw error
          }
          log(`parallel[${index}] failed: ${error instanceof Error ? error.message : String(error)}`)
          return null
        }
      }),
    )
  }

  const pipeline = async (
    items: unknown[],
    ...stages: Array<(prev: unknown, original: unknown, index: number) => unknown>
  ) => {
    throwIfAborted()
    if (!Array.isArray(items)) {
      throw new TypeError('pipeline() expects an array as the first argument')
    }
    if (stages.some((stage) => typeof stage !== 'function')) {
      throw new TypeError('pipeline() stages must be functions: pipeline(items, item => ..., result => ...)')
    }
    return Promise.all(
      items.map(async (item, index) => {
        let value: unknown = item
        for (const stage of stages) {
          try {
            throwIfAborted()
            value = await stage(value, item, index)
            throwIfAborted()
          } catch (error) {
            if (options.signal?.aborted) {
              throw error
            }
            log(`pipeline[${index}] failed: ${error instanceof Error ? error.message : String(error)}`)
            return null
          }
        }
        return value
      }),
    )
  }

  const context = createWorkflowContext({
    agent,
    parallel,
    pipeline,
    log,
    phase,
    args: options.args,
    cwd: options.cwd ?? process.cwd(),
    budget,
  })

  const wrapped = `(async () => {\n${body}\n})()`
  const result = await new vm.Script(wrapped, { filename: `${meta.name || 'workflow'}.js` }).runInContext(context, {
    timeout: options.executionTimeoutMs ?? DEFAULT_WORKFLOW_EXECUTION_TIMEOUT_MS,
  })
  await Promise.allSettled([...pendingAgentRuns])
  assertStructuredCloneable(result, 'workflow result')

  return {
    meta,
    result: result as T,
    logs: state.logs,
    phases: state.phases,
    agentCount: state.agentCount,
    durationMs: Date.now() - started,
  }
}

function createWorkflowContext(options: {
  agent: (prompt: unknown, agentOptions?: unknown) => Promise<unknown>
  parallel: (thunks: Array<() => Promise<unknown>>) => Promise<unknown[]>
  pipeline: (items: unknown[], ...stages: Array<(prev: unknown, original: unknown, index: number) => unknown>) => Promise<unknown[]>
  log: (message: unknown) => void
  phase: (title: unknown) => void
  args: unknown
  cwd: string
  budget: Readonly<{
    total: number | null
    spent: () => number
    remaining: () => number
  }>
}): vm.Context {
  const sandbox = Object.create(null) as Record<string, unknown>
  Object.assign(sandbox, {
    agent: safeCallable(options.agent),
    parallel: safeCallable(options.parallel),
    pipeline: safeCallable(options.pipeline),
    log: safeCallable(options.log),
    phase: safeCallable(options.phase),
    cwd: options.cwd,
    process: nullPrototypeObject({
      cwd: safeCallable(() => options.cwd),
    }),
    budget: nullPrototypeObject({
      total: options.budget.total,
      spent: safeCallable(options.budget.spent),
      remaining: safeCallable(options.budget.remaining),
    }),
    console: nullPrototypeObject({
      log: safeCallable(options.log),
      info: safeCallable(options.log),
      warn: safeCallable((message: unknown) => options.log(`[warn] ${String(message)}`)),
      error: safeCallable((message: unknown) => options.log(`[error] ${String(message)}`)),
    }),
    __workflowArgsJson: options.args === undefined ? undefined : JSON.stringify(options.args),
    Date: undefined,
    Function: undefined,
    eval: undefined,
  })

  const context = vm.createContext(sandbox)
  new vm.Script(
    [
      'Date = undefined',
      'Function = undefined',
      'eval = undefined',
      'Math.random = undefined',
      'Object.freeze(Math)',
      'globalThis.args = __workflowArgsJson === undefined ? undefined : JSON.parse(__workflowArgsJson)',
      'delete globalThis.__workflowArgsJson',
    ].join('\n'),
    { filename: 'workflow-sandbox-prelude.js' },
  ).runInContext(context, { timeout: DEFAULT_WORKFLOW_EXECUTION_TIMEOUT_MS })
  return context
}

function safeCallable<T extends (...args: any[]) => any>(fn: T): T {
  return new Proxy(fn, {
    get(target, property, receiver) {
      if (
        property === 'constructor' ||
        property === 'prototype' ||
        property === '__proto__' ||
        property === 'call' ||
        property === 'apply' ||
        property === 'bind'
      ) {
        return undefined
      }
      const value = Reflect.get(target, property, receiver)
      return typeof value === 'function' ? undefined : value
    },
    getPrototypeOf() {
      return null
    },
  })
}

function nullPrototypeObject(properties: Record<string, unknown>): Readonly<Record<string, unknown>> {
  return Object.freeze(Object.assign(Object.create(null), properties))
}

function normalizeConcurrency(concurrency: number | undefined): number {
  const defaultConcurrency = Math.max(1, (globalThis.navigator?.hardwareConcurrency ?? 8) - 2)
  return Math.max(1, Math.min(concurrency ?? defaultConcurrency, MAX_WORKFLOW_CONCURRENCY))
}

function createLimiter(limit: number) {
  let active = 0
  const queue: Array<() => void> = []
  const next = () => {
    active--
    queue.shift()?.()
  }
  return async <T>(fn: () => Promise<T>): Promise<T> => {
    if (active >= limit) {
      await new Promise<void>((resolve) => queue.push(resolve))
    }
    active++
    try {
      return await fn()
    } finally {
      next()
    }
  }
}

function requireString(value: unknown, name: string): string {
  if (typeof value !== 'string') {
    throw new TypeError(`${name} must be a string`)
  }
  return value
}

function optionalString(value: unknown, name: string): string | undefined {
  if (value === undefined) {
    return undefined
  }
  return requireString(value, name)
}

function normalizeAgentOptions(value: unknown): WorkflowAgentOptions {
  if (!value || typeof value !== 'object') {
    throw new TypeError('agent options must be an object')
  }
  const options = value as WorkflowAgentOptions
  const schema = normalizeJsonSchema(options.schema)
  return {
    ...options,
    label: optionalString(options.label, 'agent label'),
    phase: optionalString(options.phase, 'agent phase'),
    model: optionalString(options.model, 'agent model'),
    isolation: options.isolation,
    agentType: optionalString(options.agentType, 'agent type'),
    role: normalizeRoleValue(options.role),
    schema,
  }
}

function normalizeJsonSchema(schema: unknown): JsonSchema | undefined {
  if (schema === undefined) {
    return undefined
  }
  if (!schema || typeof schema !== 'object' || Array.isArray(schema)) {
    throw new TypeError('agent schema must be a JSON Schema object')
  }
  assertStructuredCloneable(schema, 'agent schema')
  return schema as JsonSchema
}

function normalizeRoleValue(role: unknown): AgentRole | undefined {
  return typeof role === 'string' && AGENT_ROLES.includes(role as AgentRole) ? (role as AgentRole) : undefined
}

function normalizeAgentRole(options: WorkflowAgentOptions): AgentRole {
  return options.role ?? normalizeRoleValue(options.agentType) ?? 'default'
}

function assertStructuredCloneable(value: unknown, name: string): void {
  try {
    structuredClone(value)
  } catch (error) {
    const detail = error instanceof Error ? ` ${error.message}` : ''
    throw new Error(
      `${name} must be structured-cloneable; did you forget to await agent(), parallel(), or pipeline()?${detail}`,
    )
  }
}

function defaultAgentLabel(phase: string | undefined, index: number): string {
  return phase ? `${phase} agent ${index}` : `agent ${index}`
}

function buildAgentInstructions(phase: string | undefined, options: WorkflowAgentOptions): string | undefined {
  const lines = ['This is a Gambit dynamic workflow subagent. Stay focused on the delegated task and return the requested result.']
  if (phase) {
    lines.push(`Workflow phase: ${phase}`)
  }
  if (options.agentType) {
    lines.push(`Requested subagent type/persona: ${options.agentType}`)
  }
  if (options.isolation) {
    lines.push(`Requested isolation: ${options.isolation}`)
  }
  if (options.model) {
    lines.push(`Requested model: ${options.model}`)
  }
  return lines.join('\n')
}

function estimateTokens(value: unknown): number {
  return Math.ceil(JSON.stringify(value ?? '').length / 4)
}
