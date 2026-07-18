export type Role = "system" | "user" | "assistant" | "tool";

export interface UIMessage {
  id: string;
  role: Role;
  content: string;
  timestamp: Date;
  hidden?: boolean;
  metadata?: {
    toolCallId?: string;
    toolName?: string;
    toolArgs?: unknown;
    toolResult?: unknown;
    toolStatus?: "started" | "completed" | "failed" | "cancelled";
    /** Display-only reasoning text; excluded from content replayed to the model. */
    reasoningText?: string;
    memoryContext?: boolean;
  };
}
