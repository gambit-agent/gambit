import {
  DefaultToolExecutionPipeline,
  type ToolExecutionPipeline,
  type ToolExecutionPipelineOptions,
} from './tool-execution-pipeline'
import type { ToolRegistry } from './tool-registry'
import type { ToolExecutionContext } from './tool-types'

export type {
  ToolExecutionPipeline,
  ToolExecutionPipelineOptions as ToolExecutorOptions,
  ToolExecutionResult,
} from './tool-execution-pipeline'

/**
 * Public facade for tool execution. The default implementation delegates to a
 * pipeline so lifecycle steps stay isolated and testable.
 */
export class ToolExecutor {
  private readonly pipeline: ToolExecutionPipeline

  constructor(
    registry: ToolRegistry,
    options: ToolExecutionPipelineOptions = {},
    pipeline?: ToolExecutionPipeline,
  ) {
    this.pipeline = pipeline ?? new DefaultToolExecutionPipeline(registry, options)
  }

  execute(
    toolId: string,
    input: unknown,
    context: Partial<ToolExecutionContext> = {},
  ) {
    return this.pipeline.run(toolId, input, context)
  }
}

export function createToolExecutor(
  registry: ToolRegistry,
  options: ToolExecutionPipelineOptions = {},
): ToolExecutor {
  return new ToolExecutor(registry, options)
}
