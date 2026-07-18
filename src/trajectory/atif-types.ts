export const ATIF_SCHEMA_VERSION = 'ATIF-v1.7'

export type AtifContent =
  | string
  | Array<
    | { type: 'text'; text: string }
    | { type: 'image'; source: { media_type: 'image/jpeg' | 'image/png' | 'image/gif' | 'image/webp'; path: string } }
  >

export interface AtifAgent {
  name: string
  version: string
  model_name?: string
  tool_definitions?: unknown[]
  extra?: Record<string, unknown>
}

export interface AtifMetrics {
  prompt_tokens?: number
  completion_tokens?: number
  cached_tokens?: number
  cost_usd?: number
  prompt_token_ids?: number[]
  completion_token_ids?: number[]
  logprobs?: number[]
  extra?: Record<string, unknown>
}

export interface AtifFinalMetrics {
  total_prompt_tokens?: number
  total_completion_tokens?: number
  total_cached_tokens?: number
  total_cost_usd?: number
  total_steps?: number
  extra?: Record<string, unknown>
}

export interface AtifToolCall {
  tool_call_id: string
  function_name: string
  arguments: Record<string, unknown>
  extra?: Record<string, unknown>
}

export interface AtifSubagentTrajectoryRef {
  trajectory_id?: string
  trajectory_path?: string
  session_id?: string
  extra?: Record<string, unknown>
}

export interface AtifObservationResult {
  source_call_id?: string
  content?: AtifContent
  subagent_trajectory_ref?: AtifSubagentTrajectoryRef[]
  extra?: Record<string, unknown>
}

export interface AtifObservation {
  results: AtifObservationResult[]
}

export interface AtifStep {
  step_id: number
  timestamp?: string
  source: 'system' | 'user' | 'agent'
  model_name?: string
  reasoning_effort?: string | number
  message: AtifContent
  reasoning_content?: string
  tool_calls?: AtifToolCall[]
  observation?: AtifObservation
  metrics?: AtifMetrics
  extra?: Record<string, unknown>
  llm_call_count?: number
  is_copied_context?: boolean
}

export interface AtifTrajectory {
  schema_version: typeof ATIF_SCHEMA_VERSION | string
  session_id?: string
  trajectory_id?: string
  agent: AtifAgent
  steps: AtifStep[]
  notes?: string
  final_metrics?: AtifFinalMetrics
  continued_trajectory_ref?: string
  extra?: Record<string, unknown>
  subagent_trajectories?: AtifTrajectory[]
}
