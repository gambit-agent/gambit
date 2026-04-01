import { randomUUID } from 'node:crypto'
import { mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'

import { workspaceRoot as defaultWorkspaceRoot } from '../config'
import type { ToolDefinition, ToolEventRecord, ToolExecutionContext } from './tool-types'
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

export interface ToolExecutorOptions {
  workspaceRoot?: string
  outputDirectory?: string
  maxInlineResultChars?: number
  onEvent?: (event: ToolEventRecord) => void
}

export class ToolExecutor {
  private readonly workspaceRoot: string
  private readonly outputDirectory: string
  private readonly maxInlineResultChars: number
  private readonly onEvent?: (event: ToolEventRecord) => void

  constructor(
    private readonly registry: ToolRegistry,
    options: ToolExecutorOptions = {},
  ) {
    this.workspaceRoot = options.workspaceRoot ?? defaultWorkspaceRoot
    this.outputDirectory = options.outputDirectory ?? path.join(this.workspaceRoot, '.gambit', 'tool-results')
    this.maxInlineResultChars = options.maxInlineResultChars ?? 8000
    this.onEvent = options.onEvent
  }

  async execute(
    toolId: string,
    input: unknown,
    context: Partial<ToolExecutionContext> = {},
  ): Promise<ToolExecutionResult> {
    const definition = this.registry.get(toolId)
    if (!definition) {
      throw new Error(`Tool not found: ${toolId}`)
    }

    const toolCallId = context.toolCallId ?? randomUUID()
    const startedAt = new Date().toISOString()
    const startEvent: ToolEventRecord = {
      kind: 'tool',
      toolId,
      toolCallId,
      status: 'started',
      input,
      startedAt,
    }
    this.onEvent?.(startEvent)

    let parsedInput: unknown
    try {
      parsedInput = definition.inputSchema.parse(input)
    } catch (error) {
      const failedEvent: ToolEventRecord = {
        ...startEvent,
        status: 'failed',
        error: error instanceof Error ? error.message : String(error),
        finishedAt: new Date().toISOString(),
      }
      this.onEvent?.(failedEvent)
      throw error
    }

    try {
      if (definition.getPermissionRequest && context.permissionEngine) {
        const permissionRequest = definition.getPermissionRequest(parsedInput as never)
        if (permissionRequest) {
          const decision = await context.permissionEngine.request({
            toolId,
            subject: permissionRequest.subject,
            metadata: permissionRequest.metadata,
          })

          if (decision === 'deny') {
            throw new Error(`Permission denied for ${toolId}.`)
          }
        }
      }

      const output = await definition.execute(parsedInput as never, {
        workspaceRoot: context.workspaceRoot ?? this.workspaceRoot,
        toolCallId,
        signal: context.signal,
        cwd: context.cwd ?? this.workspaceRoot,
        outputDirectory: context.outputDirectory ?? this.outputDirectory,
        taskRuntime: context.taskRuntime,
        permissionEngine: context.permissionEngine,
        shellTaskRunner: context.shellTaskRunner,
        memoryStore: context.memoryStore,
        agentTaskRunner: context.agentTaskRunner,
        agentExecutionOptions: context.agentExecutionOptions,
      })

      const normalized = await this.normalizeOutput(definition, output, parsedInput, toolCallId, context)
      const finishedAt = new Date().toISOString()
      const event: ToolEventRecord = {
        kind: 'tool',
        toolId,
        toolCallId,
        status: 'completed',
        input: parsedInput,
        output: normalized.output,
        summary: normalized.summary,
        artifactPath: normalized.artifactPath,
        startedAt,
        finishedAt,
      }
      this.onEvent?.(event)
      return {
        toolId,
        toolCallId,
        input: parsedInput,
        output: normalized.output,
        summary: normalized.summary,
        artifactPath: normalized.artifactPath,
        event,
      }
    } catch (error) {
      const failedEvent: ToolEventRecord = {
        kind: 'tool',
        toolId,
        toolCallId,
        status: 'failed',
        input: parsedInput,
        error: error instanceof Error ? error.message : String(error),
        startedAt,
        finishedAt: new Date().toISOString(),
      }
      this.onEvent?.(failedEvent)
      throw error
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

  private async writeArtifact(toolCallId: string, content: string, outputDirectory: string): Promise<string> {
    await mkdir(outputDirectory, { recursive: true })
    const artifactPath = path.join(outputDirectory, `${toolCallId}.txt`)
    await writeFile(artifactPath, content, 'utf8')
    return artifactPath
  }
}

export function createToolExecutor(
  registry: ToolRegistry,
  options: ToolExecutorOptions = {},
): ToolExecutor {
  return new ToolExecutor(registry, options)
}
