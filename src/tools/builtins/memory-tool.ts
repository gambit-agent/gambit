import type { AnyToolDefinition, ToolDefinition } from '../tool-types'
import { writeMemorySchema } from './schemas'
import { summarizeBuiltInToolCompletion } from './utils'

export function createMemoryTool(): AnyToolDefinition {
  const writeMemoryTool: ToolDefinition<typeof writeMemorySchema, string> = {
    id: 'writeMemory',
    displayName: 'Write Memory',
    description:
      'Write durable, typed memory to `.gambit/memory/`. Save only non-derivable context that will matter in future turns.',
    inputSchema: writeMemorySchema,
    requiredCapabilities: ['memory'],
    summarize: (result, context) =>
      summarizeBuiltInToolCompletion('writeMemory', context.input, result, context.artifactPath),
    execute: async ({ type, name, description, content }, context) => {
      if (!context.memoryStore) {
        throw new Error('Memory store is not configured.')
      }

      const record = await context.memoryStore.upsert({
        type,
        name,
        description,
        content,
      })
      return `Saved memory ${record.name} (${record.type}).`
    },
    getPermissionRequest: ({ name, type }) => ({
      subject: `Write ${type} memory: ${name}`,
      metadata: { name, type },
    }),
  }

  return writeMemoryTool
}
