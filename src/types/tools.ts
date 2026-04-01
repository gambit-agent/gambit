export type ToolEventStatus = 'started' | 'completed' | 'failed'

export interface ToolEventPayload {
  toolName?: string;
  name?: string;
  toolCallId?: string;
  id?: string;
  status?: ToolEventStatus;
  args?: unknown;
  arguments?: unknown;
  result?: unknown;
  output?: unknown;
  artifactPath?: string;
}
