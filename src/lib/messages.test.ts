import { describe, expect, test } from "bun:test";

import { toCoreMessages } from "./messages";
import type { UIMessage } from "../types/chat";

const at = new Date("2026-07-15T02:14:00.000Z");

function userMessage(content: string): UIMessage {
  return { id: `user-${content}`, role: "user", content, timestamp: at };
}

function assistantMessage(content: string): UIMessage {
  return { id: `assistant-${content}`, role: "assistant", content, timestamp: at };
}

function toolMessage(toolCallId: string, options: { toolArgs?: unknown; toolResult?: unknown } = {}): UIMessage {
  return {
    id: toolCallId,
    role: "tool",
    content: `ran ${toolCallId}`,
    timestamp: at,
    metadata: { toolCallId, toolName: "bash", ...options },
  };
}

describe("toCoreMessages", () => {
  test("passes through conversations without tool calls unchanged", () => {
    const result = toCoreMessages([
      { id: "sys", role: "system", content: "be helpful", timestamp: at },
      userMessage("hi"),
      assistantMessage("hello"),
    ]);

    expect(result).toEqual([
      { role: "system", content: "be helpful" },
      { role: "user", content: "hi" },
      { role: "assistant", content: "hello" },
    ]);
  });

  test("pairs tool results with a tool-call part on the preceding assistant message", () => {
    const result = toCoreMessages([
      userMessage("fix it"),
      assistantMessage("running a command"),
      toolMessage("call_1", { toolArgs: { command: "ls" }, toolResult: "ok" }),
    ]);

    expect(result[1]).toEqual({
      role: "assistant",
      content: [
        { type: "text", text: "running a command" },
        { type: "tool-call", toolCallId: "call_1", toolName: "bash", input: { command: "ls" } },
      ],
    });
    expect(result[2]).toEqual({
      role: "tool",
      content: [
        { type: "tool-result", toolCallId: "call_1", toolName: "bash", output: { type: "text", value: "ok" } },
      ],
    });
  });

  test("attaches parallel tool calls to the same assistant message", () => {
    const result = toCoreMessages([
      assistantMessage("two at once"),
      toolMessage("call_1"),
      toolMessage("call_2"),
    ]);

    expect(result).toHaveLength(3);
    const assistant = result[0];
    if (typeof assistant?.content === "string" || assistant?.role !== "assistant") {
      throw new Error("expected assistant message with content parts");
    }
    expect(assistant.content.filter((part) => part.type === "tool-call").map((part) => part.toolCallId)).toEqual([
      "call_1",
      "call_2",
    ]);
  });

  test("synthesizes an assistant message for orphaned tool results", () => {
    const result = toCoreMessages([userMessage("hi"), toolMessage("call_1", { toolArgs: { command: "ls" } })]);

    expect(result).toEqual([
      { role: "user", content: "hi" },
      {
        role: "assistant",
        content: [{ type: "tool-call", toolCallId: "call_1", toolName: "bash", input: { command: "ls" } }],
      },
      {
        role: "tool",
        content: [
          {
            type: "tool-result",
            toolCallId: "call_1",
            toolName: "bash",
            output: { type: "text", value: "ran call_1" },
          },
        ],
      },
    ]);
  });

  test("does not attach tool calls across an intervening user message", () => {
    const result = toCoreMessages([
      assistantMessage("first"),
      toolMessage("call_1"),
      userMessage("and again"),
      toolMessage("call_2"),
    ]);

    expect(result[0]).toMatchObject({
      role: "assistant",
      content: [
        { type: "text", text: "first" },
        { type: "tool-call", toolCallId: "call_1" },
      ],
    });
    expect(result[3]).toEqual({
      role: "assistant",
      content: [{ type: "tool-call", toolCallId: "call_2", toolName: "bash", input: {} }],
    });
  });

  test("defaults missing tool args to an empty object", () => {
    const result = toCoreMessages([assistantMessage("go"), toolMessage("call_1")]);

    expect(result[0]).toMatchObject({
      content: [
        { type: "text", text: "go" },
        { type: "tool-call", toolCallId: "call_1", input: {} },
      ],
    });
  });

  test("omits an empty text part when the assistant message has no text", () => {
    const result = toCoreMessages([assistantMessage(""), toolMessage("call_1")]);

    expect(result[0]).toEqual({
      role: "assistant",
      content: [{ type: "tool-call", toolCallId: "call_1", toolName: "bash", input: {} }],
    });
  });

  test("deduplicates tool-call parts that share a toolCallId", () => {
    const result = toCoreMessages([assistantMessage("go"), toolMessage("call_1"), toolMessage("call_1")]);

    const assistant = result[0];
    if (typeof assistant?.content === "string" || assistant?.role !== "assistant") {
      throw new Error("expected assistant message with content parts");
    }
    expect(assistant.content.filter((part) => part.type === "tool-call")).toHaveLength(1);
  });
});
