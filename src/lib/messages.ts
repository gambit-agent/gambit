import type {
  AssistantModelMessage,
  ModelMessage,
  ToolCallPart,
  ToolResultPart,
  UserContent,
} from "@ai-sdk/provider-utils";
import type { JSONValue } from "@ai-sdk/provider";

import type { UIMessage } from "../types/chat";

type ToolResultContentPart =
  | { type: "text"; text: string }
  | { type: "image-data"; data: string; mediaType: string };

function normalizeJsonValue(value: unknown): JSONValue {
  if (value === null) {
    return null;
  }

  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
    return value;
  }

  if (Array.isArray(value)) {
    return value.map((entry) => normalizeJsonValue(entry));
  }

  if (typeof value === "object") {
    const result: Record<string, JSONValue> = {};
    for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
      result[key] = normalizeJsonValue(entry);
    }
    return result;
  }

  return null;
}

function normalizeToolResultContent(value: unknown): ToolResultContentPart[] {
  if (!Array.isArray(value)) {
    return [];
  }

  const parts: ToolResultContentPart[] = [];
  for (const part of value) {
    if (!part || typeof part !== "object" || !("type" in part)) {
      continue;
    }

    const typedPart = part as { type?: unknown; text?: unknown; data?: unknown; mediaType?: unknown };
    if (typedPart.type === "text" && typeof typedPart.text === "string") {
      parts.push({ type: "text", text: typedPart.text });
      continue;
    }

    if (
      typedPart.type === "image-data" &&
      typeof typedPart.data === "string" &&
      typeof typedPart.mediaType === "string"
    ) {
      parts.push({ type: "image-data", data: typedPart.data, mediaType: typedPart.mediaType });
    }
  }

  return parts;
}

const toToolResultOutput = (value: unknown): ToolResultPart["output"] => {
  if (
    value &&
    typeof value === "object" &&
    "type" in value &&
    "value" in value &&
    typeof (value as { type?: unknown }).type === "string"
  ) {
    const { type, value: rawValue } = value as { type: string; value: unknown };
    if (type === "text" || type === "error-text") {
      if (typeof rawValue === "string") {
        return { type, value: rawValue };
      }
    } else if (type === "json" || type === "error-json") {
      return { type, value: normalizeJsonValue(rawValue) };
    } else if (type === "content") {
      return { type, value: normalizeToolResultContent(rawValue) };
    }
  }

  if (typeof value === "string") {
    return { type: "text", value };
  }

  return { type: "json", value: normalizeJsonValue(value) };
};

/**
 * The honest replay value for a tool message. Never substitutes the short
 * human-readable summary (`message.content`) for real tool output: the model
 * would believe it has file contents/command output it never saw.
 */
function resolveToolReplaySource(message: UIMessage): unknown {
  if (message.metadata?.toolStatus === "cancelled") {
    return "[tool cancelled before completion]";
  }
  if (message.metadata?.toolResult !== undefined) {
    return message.metadata.toolResult;
  }
  return "[tool output not persisted from a previous session; re-run the tool if needed]";
}

/**
 * Reasoning is display-only: when it was baked into the assistant content for
 * rendering (`Reasoning:\n...` prefix), strip it before replaying to the model.
 */
function stripDisplayReasoning(content: string, reasoningText: string | undefined): string {
  if (!reasoningText?.trim()) {
    return content;
  }
  const prefix = `Reasoning:\n${reasoningText.trim()}`;
  if (!content.startsWith(prefix)) {
    return content;
  }
  return content.slice(prefix.length).replace(/^\n+/, "");
}

function toUserContent(message: UIMessage): UserContent {
  const attachments = message.metadata?.attachments ?? [];
  if (attachments.length === 0) {
    return message.content;
  }

  return [
    ...(message.content ? [{ type: "text" as const, text: message.content }] : []),
    ...attachments.map((attachment) => ({
      type: "file" as const,
      data: { type: "data" as const, data: attachment.data },
      mediaType: attachment.mediaType,
      filename: attachment.name,
    })),
  ];
}

export function toCoreMessages(messages: UIMessage[]): ModelMessage[] {
  const result: ModelMessage[] = [];
  // Providers require every tool result to be paired with a tool-call part on a
  // preceding assistant message, but the store persists tool executions as
  // standalone `role: "tool"` messages. Track the assistant message that owns
  // the current run of tool messages so the pairing can be reconstructed.
  let openAssistant: AssistantModelMessage | null = null;

  for (const message of messages) {
    if (message.role === "tool") {
      const toolCallId = message.metadata?.toolCallId ?? message.id;
      const toolName = message.metadata?.toolName ?? "tool";
      const toolSource = resolveToolReplaySource(message);

      if (!openAssistant) {
        openAssistant = { role: "assistant", content: [] };
        result.push(openAssistant);
      }
      if (typeof openAssistant.content === "string") {
        openAssistant.content = openAssistant.content
          ? [{ type: "text", text: openAssistant.content }]
          : [];
      }
      const hasToolCall = openAssistant.content.some(
        (part) => part.type === "tool-call" && part.toolCallId === toolCallId,
      );
      if (!hasToolCall) {
        const toolCall: ToolCallPart = {
          type: "tool-call",
          toolCallId,
          toolName,
          input: normalizeJsonValue(message.metadata?.toolArgs ?? {}),
        };
        openAssistant.content.push(toolCall);
      }

      const toolContent: ToolResultPart = {
        type: "tool-result",
        toolCallId,
        toolName,
        output: toToolResultOutput(toolSource),
      };
      result.push({ role: "tool", content: [toolContent] });
      continue;
    }

    if (message.role === "assistant") {
      const content = stripDisplayReasoning(message.content, message.metadata?.reasoningText);
      if (!content.trim()) {
        // A reasoning-only segment (e.g. an abort mid-reasoning) strips to
        // empty content, and providers reject empty assistant messages. Skip
        // it entirely; if tool messages follow, the tool branch synthesizes
        // the pairing assistant message on demand.
        openAssistant = null;
        continue;
      }
      openAssistant = { role: "assistant", content };
      result.push(openAssistant);
      continue;
    }

    openAssistant = null;
    if (message.role === "user") {
      result.push({ role: "user", content: toUserContent(message) });
    } else {
      result.push({ role: "system", content: message.content });
    }
  }

  return result;
}
