import { readTaskOutput } from '../../tasks/task-output'
import type { AnyToolDefinition, ToolDefinition } from '../tool-types'
import {
  cancelTaskSchema,
  getTaskStatusSchema,
  listTasksSchema,
  readTaskOutputSchema,
  waitForTasksSchema,
} from './schemas'
import {
  summarizeBuiltInToolCompletion,
  summarizeTask,
} from './utils'

export function createTaskTools(): AnyToolDefinition[] {
  const readTaskOutputTool: ToolDefinition<typeof readTaskOutputSchema, string> = {
    id: 'readTaskOutput',
    displayName: 'Read Task Output',
    description: 'Read persisted output for a runtime task.',
    inputSchema: readTaskOutputSchema,
    summarize: (result, context) =>
      summarizeBuiltInToolCompletion('readTaskOutput', context.input, result, context.artifactPath),
    execute: async ({ taskId }) => readTaskOutput(taskId),
  }

  const listTasksTool: ToolDefinition<typeof listTasksSchema, Record<string, unknown>[]> = {
    id: 'listTasks',
    displayName: 'List Tasks',
    description: 'List runtime shell and agent tasks with status summaries.',
    inputSchema: listTasksSchema,
    requiredCapabilities: ['taskRuntime'],
    summarize: (result, context) =>
      summarizeBuiltInToolCompletion('listTasks', context.input, result, context.artifactPath),
    execute: async (_input, context) => {
      const tasks = context.taskRuntime?.getSnapshot().tasks ?? []
      return tasks.map(summarizeTask)
    },
  }

  const getTaskStatusTool: ToolDefinition<typeof getTaskStatusSchema, Record<string, unknown> | string> = {
    id: 'getTaskStatus',
    displayName: 'Get Task Status',
    description: 'Read status metadata for a runtime task.',
    inputSchema: getTaskStatusSchema,
    requiredCapabilities: ['taskRuntime'],
    summarize: (result, context) =>
      summarizeBuiltInToolCompletion('getTaskStatus', context.input, result, context.artifactPath),
    execute: async ({ taskId }, context) => {
      const task = await context.taskRuntime?.getTask(taskId)
      return task ? summarizeTask(task) : `Task not found: ${taskId}`
    },
  }

  const waitForTasksTool: ToolDefinition<typeof waitForTasksSchema, Record<string, unknown>[]> = {
    id: 'waitForTasks',
    displayName: 'Wait For Tasks',
    description:
      'Wait until runtime shell or agent tasks finish. Use this instead of sleeping and repeatedly checking task status.',
    inputSchema: waitForTasksSchema,
    requiredCapabilities: ['taskRuntime'],
    summarize: (result, context) =>
      summarizeBuiltInToolCompletion('waitForTasks', context.input, result, context.artifactPath),
    execute: async ({ taskIds, timeoutMs }, context) => {
      if (!context.taskRuntime) {
        throw new Error('Task runtime is not configured.')
      }
      const tasks = await context.taskRuntime.waitForTasks(taskIds, {
        signal: context.signal,
        timeoutMs,
      })
      return tasks.map(summarizeTask)
    },
  }

  const cancelTaskTool: ToolDefinition<typeof cancelTaskSchema, Record<string, unknown> | string> = {
    id: 'cancelTask',
    displayName: 'Cancel Task',
    description: 'Cancel a pending or running runtime task.',
    inputSchema: cancelTaskSchema,
    requiredCapabilities: ['taskRuntime'],
    summarize: (result, context) =>
      summarizeBuiltInToolCompletion('cancelTask', context.input, result, context.artifactPath),
    execute: async ({ taskId }, context) => {
      if (!context.taskRuntime) {
        throw new Error('Task runtime is not configured.')
      }
      const task = await context.taskRuntime.cancelTask(taskId)
      return task ? summarizeTask(task) : `Task not found: ${taskId}`
    },
    getPermissionRequest: ({ taskId }) => ({
      subject: `Cancel task: ${taskId}`,
      metadata: { taskId },
    }),
  }

  return [readTaskOutputTool, listTasksTool, getTaskStatusTool, waitForTasksTool, cancelTaskTool]
}
