import { mkdir } from 'node:fs/promises'
import path from 'node:path'

import { MAX_INLINE_TOOL_RESULT_CHARS, workspaceRoot as defaultWorkspaceRoot } from '../config'
import { generateId } from '../lib/id'
import { PermissionPolicy } from '../permissions/permission-policy'
import type { AnyToolDefinition, ToolCapability, ToolDefinition, ToolEventRecord, ToolExecutionContext } from './tool-types'
import type { ToolRegistry } from './tool-registry'

export interface ToolExecutionResult<Output = unknown> {
  toolId: string
  toolCallId: string
  input: unknown
  output: Output
  summary: string
  artifactPath?: string
  event: ToolEventRecord
}

export interface ToolExecutionPipeline {
  run(toolId: string, input: unknown, context?: Partial<ToolExecutionContext>): Promise<ToolExecutionResult>
}

export interface ToolExecutionPipelineOptions {
  workspaceRoot?: string
  outputDirectory?: string
  maxInlineResultChars?: number
  onEvent?: (event: ToolEventRecord) => void
}

interface ExecutionState {
  definition: AnyToolDefinition
  toolId: string
  toolCallId: string
  startedAt: string
  startEvent: ToolEventRecord
  rawInput: unknown
  parsedInput?: unknown
}

const capabilityAccessors: Record<ToolCapability, (context: ToolExecutionContext) => boolean> = {
  taskRuntime: (context) => Boolean(context.taskRuntime),
  permissions: (context) => Boolean(context.permissionEngine),
  questions: (context) => Boolean(context.questionEngine),
  shell: (context) => Boolean(context.shellTaskRunner),
  memory: (context) => Boolean(context.memoryStore),
  agents: (context) => Boolean(context.agentTaskRunner && context.agentExecutionOptions),
  hooks: (context) => Boolean(context.hookManager),
}

export class DefaultToolExecutionPipeline implements ToolExecutionPipeline {
  private readonly workspaceRoot: string
  private readonly outputDirectory: string
  private readonly maxInlineResultChars: number
  private readonly onEvent?: (event: ToolEventRecord) => void
  private readonly permissionPolicy = new PermissionPolicy()

  constructor(
    private readonly registry: ToolRegistry,
    options: ToolExecutionPipelineOptions = {},
  ) {
    this.workspaceRoot = options.workspaceRoot ?? defaultWorkspaceRoot
    this.outputDirectory = options.outputDirectory ?? path.join(this.workspaceRoot, '.gambit', 'tool-results')
    this.maxInlineResultChars = options.maxInlineResultChars ?? MAX_INLINE_TOOL_RESULT_CHARS
    this.onEvent = options.onEvent
  }

  async run(
    toolId: string,
    input: unknown,
    context: Partial<ToolExecutionContext> = {},
  ): Promise<ToolExecutionResult> {
    const state = this.createState(toolId, input, context)
    this.emitStart(state)
    await this.emitBeforeHook(state, context)

    try {
      state.parsedInput = await this.parseInput(state, context)
    } catch (error) {
      await this.fail(state, context, error)
      throw error
    }

    try {
      await this.evaluatePermission(state, context)
      const executionContext = this.createExecutionContext(context, state.toolCallId)
      this.assertCapabilities(state.definition, executionContext)

      const output = await state.definition.execute(state.parsedInput, executionContext)
      const normalized = await this.normalizeOutput(
        state.definition,
        output,
        state.parsedInput,
        state.toolCallId,
        context,
      )
      const hookedOutput = await this.runAfterHook(state, context, normalized)
      const completed = this.complete(state, hookedOutput, normalized)
      await this.emitCompletedHook(state, context, completed.output)
      return completed
    } catch (error) {
      await this.fail(state, context, error)
      throw error
    }
  }

  private createState(
    toolId: string,
    input: unknown,
    context: Partial<ToolExecutionContext>,
  ): ExecutionState {
    const definition = this.registry.get(toolId)
    if (!definition) {
      throw new Error(`Tool not found: ${toolId}`)
    }

    const toolCallId = context.toolCallId ?? generateId()
    const startedAt = new Date().toISOString()
    return {
      definition,
      toolId,
      toolCallId,
      startedAt,
      rawInput: input,
      startEvent: {
        kind: 'tool',
        toolId,
        toolCallId,
        status: 'started',
        input,
        startedAt,
      },
    }
  }

  private emitStart(state: ExecutionState): void {
    this.onEvent?.(state.startEvent)
  }

  private async emitBeforeHook(
    state: ExecutionState,
    context: Partial<ToolExecutionContext>,
  ): Promise<void> {
    await context.hookManager?.emit({
      type: 'tool.execute.before',
      sessionID: context.sessionId,
      data: { tool: state.toolId, callID: state.toolCallId, args: state.rawInput },
    })
  }

  private async parseInput(
    state: ExecutionState,
    context: Partial<ToolExecutionContext>,
  ): Promise<unknown> {
    const hookedInput = context.hookManager
      ? await context.hookManager.runToolBefore({
          tool: state.toolId,
          sessionID: context.sessionId,
          callID: state.toolCallId,
          args: state.rawInput,
        })
      : state.rawInput

    return state.definition.inputSchema.parse(hookedInput)
  }

  private async evaluatePermission(
    state: ExecutionState,
    context: Partial<ToolExecutionContext>,
  ): Promise<void> {
    if (!state.definition.getPermissionRequest || !context.permissionEngine) {
      return
    }

    const permissionRequest = await state.definition.getPermissionRequest(state.parsedInput)
    if (!permissionRequest) {
      return
    }

    const decision = await context.permissionEngine.request(
      this.permissionPolicy.buildToolRequest(state.definition, state.parsedInput, permissionRequest),
    )
    if (decision === 'deny') {
      throw new Error(`Permission denied for ${state.toolId}.`)
    }
  }

  private createExecutionContext(
    context: Partial<ToolExecutionContext>,
    toolCallId: string,
  ): ToolExecutionContext {
    return {
      workspaceRoot: context.workspaceRoot ?? this.workspaceRoot,
      toolCallId,
      signal: context.signal,
      cwd: context.cwd ?? this.workspaceRoot,
      outputDirectory: context.outputDirectory ?? this.outputDirectory,
      sessionId: context.sessionId,
      taskRuntime: context.taskRuntime,
      permissionEngine: context.permissionEngine,
      questionEngine: context.questionEngine,
      shellTaskRunner: context.shellTaskRunner,
      memoryStore: context.memoryStore,
      agentTaskRunner: context.agentTaskRunner,
      hookManager: context.hookManager,
      agentExecutionOptions: context.agentExecutionOptions,
    }
  }

  private assertCapabilities(definition: AnyToolDefinition, context: ToolExecutionContext): void {
    const missing = (definition.requiredCapabilities ?? []).filter(
      (capability) => !capabilityAccessors[capability](context),
    )
    if (missing.length > 0) {
      throw new Error(`Tool ${definition.id} is missing required runtime capability: ${missing.join(', ')}.`)
    }
  }

  private async normalizeOutput<Output>(
    definition: ToolDefinition<any, Output>,
    output: Output,
    input: unknown,
    toolCallId: string,
    context: Partial<ToolExecutionContext>,
  ): Promise<{ output: Output | string; summary: string; artifactPath?: string }> {
    const shouldPersistLargeResult = definition.shouldPersistLargeResult ?? true
    const maxInlineResultChars = definition.maxInlineResultChars ?? this.maxInlineResultChars

    if (typeof output === 'string') {
      return await this.normalizeStringOutput({
        definition,
        output,
        input,
        toolCallId,
        shouldPersistLargeResult,
        maxInlineResultChars,
        outputDirectory: context.outputDirectory ?? this.outputDirectory,
      })
    }

    const serialized = JSON.stringify(output, null, 2)
    if (!shouldPersistLargeResult || serialized.length <= maxInlineResultChars) {
      return {
        output,
        summary: definition.summarize ? definition.summarize(output, { input }) : serialized,
      }
    }

    const artifactPath = await this.writeArtifact(toolCallId, serialized, context.outputDirectory ?? this.outputDirectory)
    const summary = definition.summarize
      ? definition.summarize(output, { input, artifactPath })
      : `Stored large tool result in ${artifactPath}.`
    return { output, summary, artifactPath }
  }

  private async normalizeStringOutput(options: {
    definition: ToolDefinition<any, any>
    output: string
    input: unknown
    toolCallId: string
    shouldPersistLargeResult: boolean
    maxInlineResultChars: number
    outputDirectory: string
  }): Promise<{ output: string; summary: string; artifactPath?: string }> {
    const { definition, output, input, toolCallId, shouldPersistLargeResult, maxInlineResultChars, outputDirectory } =
      options
    if (!shouldPersistLargeResult || output.length <= maxInlineResultChars) {
      return {
        output,
        summary: definition.summarize ? definition.summarize(output, { input }) : output,
      }
    }

    const artifactPath = await this.writeArtifact(toolCallId, output, outputDirectory)
    const summary = definition.summarize
      ? definition.summarize(output, { input, artifactPath })
      : `Stored large tool result in ${artifactPath}.`
    return { output, summary, artifactPath }
  }

  private async runAfterHook(
    state: ExecutionState,
    context: Partial<ToolExecutionContext>,
    normalized: { output: unknown; summary: string; artifactPath?: string },
  ): Promise<{ output: unknown; summary?: string; metadata?: Record<string, unknown> }> {
    if (!context.hookManager) {
      return normalized
    }

    return context.hookManager.runToolAfter({
      tool: state.toolId,
      sessionID: context.sessionId,
      callID: state.toolCallId,
      args: state.parsedInput,
      output: normalized.output,
      summary: normalized.summary,
      metadata: normalized.artifactPath ? { artifactPath: normalized.artifactPath } : undefined,
    })
  }

  private complete(
    state: ExecutionState,
    hookedOutput: { output: unknown; summary?: string },
    normalized: { summary: string; artifactPath?: string },
  ): ToolExecutionResult {
    const summary = hookedOutput.summary ?? normalized.summary
    const event: ToolEventRecord = {
      kind: 'tool',
      toolId: state.toolId,
      toolCallId: state.toolCallId,
      status: 'completed',
      input: state.parsedInput,
      output: hookedOutput.output,
      summary,
      artifactPath: normalized.artifactPath,
      startedAt: state.startedAt,
      finishedAt: new Date().toISOString(),
    }
    this.onEvent?.(event)
    return {
      toolId: state.toolId,
      toolCallId: state.toolCallId,
      input: state.parsedInput,
      output: hookedOutput.output,
      summary,
      artifactPath: normalized.artifactPath,
      event,
    }
  }

  private async emitCompletedHook(
    state: ExecutionState,
    context: Partial<ToolExecutionContext>,
    output: unknown,
  ): Promise<void> {
    await context.hookManager?.emit({
      type: 'tool.execute.after',
      sessionID: context.sessionId,
      data: { tool: state.toolId, callID: state.toolCallId, status: 'completed', output },
    })
  }

  private async fail(
    state: ExecutionState,
    context: Partial<ToolExecutionContext>,
    error: unknown,
  ): Promise<void> {
    const failedEvent: ToolEventRecord = {
      kind: 'tool',
      toolId: state.toolId,
      toolCallId: state.toolCallId,
      status: 'failed',
      input: state.parsedInput ?? state.rawInput,
      error: error instanceof Error ? error.message : String(error),
      startedAt: state.startedAt,
      finishedAt: new Date().toISOString(),
    }
    this.onEvent?.(failedEvent)
    await context.hookManager?.emit({
      type: 'tool.execute.after',
      sessionID: context.sessionId,
      data: { tool: state.toolId, callID: state.toolCallId, status: 'failed', error: failedEvent.error },
    })
  }

  private async writeArtifact(toolCallId: string, content: string, outputDirectory: string): Promise<string> {
    await mkdir(outputDirectory, { recursive: true })
    const artifactPath = path.join(outputDirectory, `${toolCallId}.txt`)
    await Bun.write(artifactPath, content)
    return artifactPath
  }
}
