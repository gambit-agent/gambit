import { afterEach, beforeEach, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { setWorkspaceRootForTesting, workspaceRoot } from "../config";
import { createAgentToolMap, type AgentTools } from "./index";

let workspaceDir: string;
let originalWorkspaceRootEnv: string | undefined;
let originalWorkspaceRootValue: string;
let agentTools: AgentTools;

beforeEach(async () => {
  workspaceDir = await mkdtemp(path.join(tmpdir(), "gambit-tools-"));
  originalWorkspaceRootEnv = process.env.WORKSPACE_ROOT;
  originalWorkspaceRootValue = workspaceRoot;
  process.env.WORKSPACE_ROOT = workspaceDir;
  setWorkspaceRootForTesting(workspaceDir);
  agentTools = await createAgentToolMap({ workspaceRoot: workspaceDir, includeMCPTools: false });
});

afterEach(async () => {
  await rm(workspaceDir, { recursive: true, force: true });
  if (originalWorkspaceRootEnv === undefined) {
    delete process.env.WORKSPACE_ROOT;
  } else {
    process.env.WORKSPACE_ROOT = originalWorkspaceRootEnv;
  }
  setWorkspaceRootForTesting(originalWorkspaceRootValue);
});

test("readFile rejects missing path", async () => {
  await expect(agentTools.readFile.execute({} as any)).rejects.toThrow('"path"');
});

test("writeFile rejects non-string content", async () => {
  await expect(
    agentTools.writeFile.execute({ path: "file.txt", content: undefined as any }),
  ).rejects.toThrow('"content"');
});

test("executeShell rejects non-string command", async () => {
  await expect(agentTools.executeShell.execute({ command: undefined as any })).rejects.toThrow(
    '"command"',
  );
});
