import path from 'node:path'

import type {
  ContentBlock,
  SessionConfigOption,
  SessionConfigSelectOption,
  StopReason,
  ToolCallContent,
  ToolCallLocation,
  ToolCallStatus,
  ToolKind,
} from '@agentclientprotocol/sdk'

import { reasoningEfforts, type ReasoningEffort } from '../lib/model'
import { createImageAttachment, type ImageAttachment } from '../lib/image-attachments'
import type { PermissionMode } from '../permissions/permission-rules'
import type { ConversationMessage, ConversationTurnRecord } from '../conversation/conversation-types'

const MAX_ACP_TOOL_OUTPUT_CHARS = 16_384

export interface AcpPromptInput {
  text: string
  attachments: ImageAttachment[]
}

export function promptBlocksToInput(blocks: readonly ContentBlock[]): AcpPromptInput {
  const attachments: ImageAttachment[] = []
  const text = blocks
    .map((block) => {
      switch (block.type) {
        case 'text':
          return block.text
        case 'resource_link':
          return `[${block.title ?? block.name}](${block.uri})`
        case 'resource':
          if ('text' in block.resource) {
            return `Resource ${block.resource.uri}:\n${block.resource.text}`
          }
          throw new Error(`Binary embedded resources are not supported: ${block.resource.uri}`)
        case 'image': {
          const name = block.uri
            ? path.basename(block.uri.replace(/^file:\/\//, ''))
            : undefined
          attachments.push(createImageAttachment(Buffer.from(block.data, 'base64'), {
            name,
            mediaType: block.mimeType,
          }))
          return ''
        }
        case 'audio':
          throw new Error(`ACP ${block.type} prompt content is not supported.`)
      }
    })
    .filter(Boolean)
    .join('\n\n')
    .trim()
  return { text, attachments }
}

export function promptBlocksToText(blocks: readonly ContentBlock[]): string {
  return promptBlocksToInput(blocks).text
}

export function getToolKind(toolName: string): ToolKind {
  if (['read', 'readFile', 'glob', 'globFiles'].includes(toolName)) return 'read'
  if (['grep', 'grepFiles', 'searchFiles'].includes(toolName)) return 'search'
  if (['write', 'writeFile', 'edit', 'editFile', 'patchFile'].includes(toolName)) return 'edit'
  if (['bash', 'executeShell', 'workflow'].includes(toolName)) return 'execute'
  if (['spawnAgent', 'runAgents'].includes(toolName)) return 'think'
  if (toolName.toLowerCase().includes('fetch')) return 'fetch'
  if (toolName === 'enterPlanMode' || toolName === 'exitPlanMode') return 'switch_mode'
  return 'other'
}

export function getToolStatus(
  status: 'started' | 'completed' | 'failed' | 'cancelled' | undefined,
): ToolCallStatus {
  switch (status) {
    case 'completed':
      return 'completed'
    case 'failed':
    case 'cancelled':
      return 'failed'
    case 'started':
    default:
      return 'in_progress'
  }
}

export function getToolLocations(input: unknown, cwd: string): ToolCallLocation[] | undefined {
  if (!input || typeof input !== 'object') return undefined

  const record = input as Record<string, unknown>
  const candidates = ['path', 'filePath', 'targetPath', 'source', 'destination']
  const locations = candidates.flatMap((key) => {
    const value = record[key]
    if (typeof value !== 'string' || !value.trim() || /^[a-z]+:\/\//i.test(value)) return []
    return [{ path: path.resolve(cwd, value) }]
  })
  return locations.length > 0 ? locations : undefined
}

export function getToolContent(message: ConversationMessage): ToolCallContent[] | undefined {
  const output = message.metadata?.toolResult ?? message.content
  if (output === undefined || output === null || output === '') return undefined
  const text = capSerializedValue(output)
  return [{ type: 'content', content: { type: 'text', text } }]
}

export function capSerializedValue(value: unknown): string {
  let serialized: string
  if (typeof value === 'string') {
    serialized = value
  } else {
    try {
      serialized = JSON.stringify(value, null, 2) ?? String(value)
    } catch {
      serialized = String(value)
    }
  }
  if (serialized.length <= MAX_ACP_TOOL_OUTPUT_CHARS) return serialized
  return `${serialized.slice(0, MAX_ACP_TOOL_OUTPUT_CHARS)}\n[truncated]`
}

export function buildSessionConfigOptions(
  permissionMode: PermissionMode,
  modelId: string | null,
  modelOptions: readonly SessionConfigSelectOption[],
  reasoningEffort: ReasoningEffort | null,
): SessionConfigOption[] {
  return [
    {
      type: 'select',
      id: 'model',
      name: 'Model',
      category: 'model',
      currentValue: modelId ?? '__gambit_no_model__',
      options: [
        ...(modelId ? [] : [{
          value: '__gambit_no_model__',
          name: 'Select a model',
          description: 'Choose a model before sending a prompt.',
        }]),
        ...modelOptions,
      ],
    },
    {
      type: 'select',
      id: 'permission-mode',
      name: 'Permission mode',
      category: 'mode',
      currentValue: permissionMode,
      options: [
        { value: 'Normal', name: 'Normal', description: 'Ask before write and execution tools.' },
        { value: 'Auto-accept', name: 'Auto-accept', description: 'Allow all tool calls.' },
        { value: 'Plan', name: 'Plan', description: 'Restrict tools to planning-safe operations.' },
      ],
    },
    {
      type: 'select',
      id: 'reasoning-effort',
      name: 'Reasoning effort',
      category: 'thought_level',
      currentValue: reasoningEffort ?? 'default',
      options: [
        { value: 'default', name: 'Default' },
        ...reasoningEfforts.map((effort) => ({
          value: effort,
          name: effort.charAt(0).toUpperCase() + effort.slice(1),
        })),
      ],
    },
  ]
}

export function mapStopReason(turn: ConversationTurnRecord): StopReason {
  if (turn.interrupted) return 'cancelled'
  if (turn.finishReason === 'length') return 'max_tokens'
  if (turn.finishReason === 'content-filter' || turn.finishReason === 'refusal') return 'refusal'
  return 'end_turn'
}
