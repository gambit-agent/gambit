/**
 * Stream event types emitted in `--output-format stream-json` (or `--events`) mode.
 * Each event is a single JSON line written to stdout.
 */

export interface StreamEventInit {
  type: 'system'
  subtype: 'init'
  session_id: string
  model: string
  provider: string | null
  cwd: string
  permission_mode: string
  tools: string[] | null
}

export interface StreamEventUser {
  type: 'user'
  session_id: string
  message: { role: 'user'; content: string }
}

export interface StreamEventDelta {
  type: 'stream_event'
  session_id: string
  message_id: string
  event: { delta: { type: 'text_delta'; text: string } }
}

export interface StreamEventToolUse {
  type: 'tool_use'
  session_id: string
  id: string
  name: string
  input: unknown
}

export interface StreamEventToolResult {
  type: 'tool_result'
  session_id: string
  tool_use_id: string
  is_error: boolean
  content: unknown
}

export interface StreamEventAssistant {
  type: 'assistant'
  session_id: string
  message: { role: 'assistant'; content: Array<{ type: 'text'; text: string }> }
}

export interface StreamEventResult {
  type: 'result'
  session_id: string
  result: string
  is_error: boolean
  error?: string
  duration_ms: number
  num_turns: number
  model: string
}

export type StreamEvent =
  | StreamEventInit
  | StreamEventUser
  | StreamEventDelta
  | StreamEventToolUse
  | StreamEventToolResult
  | StreamEventAssistant
  | StreamEventResult
