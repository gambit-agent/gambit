import type { ModelMessage, ToolResultPart } from "@ai-sdk/provider-utils";
import type { JSONValue } from "@ai-sdk/provider";

import type { UIMessage } from "../types/chat";
import type { ToolEventPayload } from "../types/tools";

type ToolResultContentPart =
  | { type: "text"; text: string }
  | { type: "media"; data: string; mediaType: string };

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
      typedPart.type === "media" &&
      typeof typedPart.data === "string" &&
      typeof typedPart.mediaType === "string"
    ) {
      parts.push({ type: "media", data: typedPart.data, mediaType: typedPart.mediaType });
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
  return messages.map<ModelMessage>((message) => {
    if (message.role === "tool") {
      const toolCallId = message.metadata?.toolCallId ?? message.id;
      const toolName = message.metadata?.toolName ?? "tool";
      const toolSource = message.metadata?.toolResult ?? message.content;
      const toolContent: ToolResultPart = {
        type: "tool-result",
        toolCallId,
        toolName,
        output: toToolResultOutput(toolSource),
      };
      return { role: "tool", content: [toolContent] };
    }

    return { role: message.role, content: message.content };
  });
}

export function formatToolEvent(event: ToolEventPayload): string {
  const toolName = String(event.toolName ?? event.name ?? "tool");
  const args = event.args ?? event.arguments ?? {};
  const result = event.result ?? event.output;

  const formattedArgs = JSON.stringify(args, null, 2);
  const formattedResult =
    typeof result === "string" ? result : JSON.stringify(result, null, 2);

  return [
    `[tool:${toolName}]`,
    `arguments: ${formattedArgs}`,
    result !== undefined ? `result: ${formattedResult}` : "result: <pending>",
  ].join("\n");
}
