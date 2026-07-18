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
            output: {
              type: "text",
              value: "[tool output not persisted from a previous session; re-run the tool if needed]",
            },
          },
        ],
      },
    ]);
  });

  test("never substitutes the human summary for a missing tool result", () => {
    // Legacy transcripts persisted only the short summary in `content`; the
    // model must not be told that summary is the tool output.
    const legacy: UIMessage = {
      id: "call_1",
      role: "tool",
      content: "Read file\nsecrets.txt · 2 KB",
      timestamp: at,
      metadata: { toolCallId: "call_1", toolName: "readFile", toolStatus: "completed" },
    };

    const result = toCoreMessages([assistantMessage("reading"), legacy]);
    const tool = result[1];
    if (tool?.role !== "tool" || typeof tool.content === "string") {
      throw new Error("expected structured tool message");
    }
    const part = tool.content[0];
    if (part?.type !== "tool-result") {
      throw new Error("expected tool-result part");
    }
    expect(part.output).toEqual({
      type: "text",
      value: "[tool output not persisted from a previous session; re-run the tool if needed]",
    });
  });

  test("replays cancelled tools as cancelled, even when a result text exists", () => {
    const cancelled: UIMessage = {
      id: "call_1",
      role: "tool",
      content: "Ran command\nsleep 100\n[cancelled by user]",
      timestamp: at,
      metadata: {
        toolCallId: "call_1",
        toolName: "bash",
        toolArgs: { command: "sleep 100" },
        toolResult: "[cancelled by user]",
        toolStatus: "cancelled",
      },
    };

    const result = toCoreMessages([assistantMessage("running"), cancelled]);
    const tool = result[1];
    if (tool?.role !== "tool" || typeof tool.content === "string") {
      throw new Error("expected structured tool message");
    }
    const part = tool.content[0];
    if (part?.type !== "tool-result") {
      throw new Error("expected tool-result part");
    }
    expect(part.output).toEqual({ type: "text", value: "[tool cancelled before completion]" });
  });

  test("strips display-only reasoning from replayed assistant content", () => {
    const withReasoning: UIMessage = {
      id: "assistant-1",
      role: "assistant",
      content: "Reasoning:\nI should check the file first.\n\nHere is the answer.",
      timestamp: at,
      metadata: { reasoningText: "I should check the file first." },
    };

    const result = toCoreMessages([userMessage("hi"), withReasoning]);
    expect(result[1]).toEqual({ role: "assistant", content: "Here is the answer." });
  });

  test("keeps assistant content intact when no reasoning metadata is present", () => {
    const plain: UIMessage = {
      id: "assistant-1",
      role: "assistant",
      content: "Reasoning:\nnot actually metadata reasoning\n\nanswer",
      timestamp: at,
    };

    const result = toCoreMessages([plain]);
    expect(result[0]).toEqual({ role: "assistant", content: plain.content });
  });

  test("skips assistant segments that strip to empty content (reasoning-only abort)", () => {
    // An abort mid-reasoning persists an assistant segment whose content is
    // only the display reasoning; replaying it as an empty assistant message
    // makes providers reject the whole request and wedges the conversation.
    const reasoningOnly: UIMessage = {
      id: "assistant-1",
      role: "assistant",
      content: "Reasoning:\nI was thinking about the file.",
      timestamp: at,
      metadata: { reasoningText: "I was thinking about the file." },
    };

    const result = toCoreMessages([userMessage("hi"), reasoningOnly]);
    expect(result).toEqual([{ role: "user", content: "hi" }]);
  });

  test("pairs tool messages correctly after a skipped reasoning-only assistant segment", () => {
    const reasoningOnly: UIMessage = {
      id: "assistant-1",
      role: "assistant",
      content: "Reasoning:\nLet me run a command.",
      timestamp: at,
      metadata: { reasoningText: "Let me run a command." },
    };

    const result = toCoreMessages([
      userMessage("hi"),
      reasoningOnly,
      toolMessage("call_1", { toolArgs: { command: "ls" }, toolResult: "ok" }),
    ]);

    expect(result).toEqual([
      { role: "user", content: "hi" },
      {
        role: "assistant",
        content: [{ type: "tool-call", toolCallId: "call_1", toolName: "bash", input: { command: "ls" } }],
      },
      {
        role: "tool",
        content: [
          { type: "tool-result", toolCallId: "call_1", toolName: "bash", output: { type: "text", value: "ok" } },
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
