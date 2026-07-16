import type { AssistantModelMessage, ModelMessage, ToolCallPart, ToolResultPart } from "@ai-sdk/provider-utils";
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
      const toolSource = message.metadata?.toolResult ?? message.content;

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
      openAssistant = { role: "assistant", content: message.content };
      result.push(openAssistant);
      continue;
    }

    openAssistant = null;
    result.push({ role: message.role, content: message.content });
  }

  return result;
}
