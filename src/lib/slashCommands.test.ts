import { afterEach, beforeEach, expect, test } from "bun:test";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { setWorkspaceRootForTesting, workspaceRoot as originalWorkspaceRoot } from "../config";
import {
  buildSlashCommandToolDescription,
  executeSlashCommand,
  loadSlashCommands,
  setSlashCommandDirectoriesForTesting,
} from "./slashCommands";

let workspaceDir: string;
let userRoot: string;
let projectCommandsDir: string;
let userCommandsDir: string;
let originalWorkspaceRootEnv: string | undefined;

beforeEach(async () => {
  workspaceDir = await mkdtemp(path.join(tmpdir(), "gambit-slash-project-"));
  userRoot = await mkdtemp(path.join(tmpdir(), "gambit-slash-user-"));
  projectCommandsDir = path.join(workspaceDir, ".gambit", "commands");
  userCommandsDir = path.join(userRoot, ".gambit", "commands");

  await mkdir(projectCommandsDir, { recursive: true });
  await mkdir(userCommandsDir, { recursive: true });

  originalWorkspaceRootEnv = process.env.WORKSPACE_ROOT;
  process.env.WORKSPACE_ROOT = workspaceDir;
  setWorkspaceRootForTesting(workspaceDir);
  setSlashCommandDirectoriesForTesting({ project: projectCommandsDir, user: userCommandsDir });
});

afterEach(async () => {
  await removeDirectoryWithRetry(workspaceDir);
  await removeDirectoryWithRetry(userRoot);

  if (originalWorkspaceRootEnv === undefined) {
    delete process.env.WORKSPACE_ROOT;
  } else {
    process.env.WORKSPACE_ROOT = originalWorkspaceRootEnv;
  }
  setWorkspaceRootForTesting(originalWorkspaceRoot);
  setSlashCommandDirectoriesForTesting({ project: null, user: null });
});

test("loads project and user commands with metadata", async () => {
  await writeFile(
    path.join(projectCommandsDir, "optimize.md"),
    "" +
      "---\n" +
      "description: Analyze performance\n" +
      "argument-hint: [file]\n" +
      "allowed-tools: Bash(git status:*), Bash(git diff:*)\n" +
      "---\n" +
      "Review $ARGUMENTS for slow paths.\n",
  );

  await mkdir(path.join(projectCommandsDir, "frontend"), { recursive: true });
  await writeFile(
    path.join(projectCommandsDir, "frontend", "component.md"),
    "Inspect component rendering.",
  );

  await writeFile(
    path.join(userCommandsDir, "notes.md"),
    "---\n" +
      "description: Personal scratch pad\n" +
      "---\n" +
      "Capture thoughts: $ARGUMENTS\n",
  );

  const commands = await loadSlashCommands();
  expect(commands.map((command) => command.id)).toEqual([
    "frontend/component",
    "notes",
    "optimize",
  ]);

  const optimize = commands.find((command) => command.id === "optimize");
  expect(optimize).toBeTruthy();
  expect(optimize?.scope).toBe("project");
  expect(optimize?.allowedTools).toEqual([
    "Bash(git status:*)",
    "Bash(git diff:*)",
  ]);
  expect(optimize?.argumentHint).toBe("[file]");
  expect(optimize?.description).toBe("Analyze performance");

  const description = buildSlashCommandToolDescription(commands);
  expect(description).toContain("/optimize");
  expect(description).toContain("(project)");
  expect(description).toContain("[args: [file]");
});

test("executes slash commands with arguments and embedded shell output", async () => {
  await writeFile(
    path.join(projectCommandsDir, "fix-issue.md"),
    "" +
      "Prepare fix for issue $1.\n" +
      "!`echo inline-output`\n" +
      "! printf 'block-output'\n" +
      "All args: $ARGUMENTS\n",
  );

  const result = await executeSlashCommand("fix-issue", "123 high-priority");
  expect(result.command).toBe("/fix-issue");
  expect(result.arguments).toBe("123 high-priority");
  expect(result.content).toContain("Prepare fix for issue 123.");
  expect(result.content).toContain("inline-output");
  expect(result.content).toContain("block-output");
  expect(result.content).toContain("All args: 123 high-priority");
  expect(result.content).toMatch(/```text[\s\S]+command: echo inline-output/);
});

test("requires disambiguation when multiple namespaces share command name", async () => {
  await mkdir(path.join(projectCommandsDir, "frontend"), { recursive: true });
  await mkdir(path.join(projectCommandsDir, "backend"), { recursive: true });

  await writeFile(
    path.join(projectCommandsDir, "frontend", "review.md"),
    "Frontend review: $ARGUMENTS",
  );
  await writeFile(
    path.join(projectCommandsDir, "backend", "review.md"),
    "Backend review: $ARGUMENTS",
  );

  await expect(executeSlashCommand("review", ""))
    .rejects.toThrow(/Multiple commands match/);

  const frontend = await executeSlashCommand("frontend/review", "story-456");
  expect(frontend.command).toBe("/frontend/review");
  expect(frontend.content).toContain("Frontend review: story-456");
});

test("ignores user command when project command shares base name", async () => {
  await writeFile(path.join(projectCommandsDir, "deploy.md"), "Project deploy");
  await writeFile(path.join(userCommandsDir, "deploy.md"), "User deploy");

  const commands = await loadSlashCommands();
  expect(commands.filter((command) => command.name === "deploy")).toHaveLength(1);
  expect(commands[0]?.scope).toBe("project");
});

test("allows direct user execution of model-disabled slash commands", async () => {
  await writeFile(
    path.join(projectCommandsDir, "local-only.md"),
    "---\n" +
      "description: Local helper\n" +
      "disable-model-invocation: true\n" +
      "---\n" +
      "Local content: $ARGUMENTS\n",
  );

  await expect(executeSlashCommand("local-only", "now"))
    .rejects.toThrow(/disabled for model invocation/);

  const result = await executeSlashCommand("local-only", "now", {
    allowDisabledModelInvocation: true,
  });

  expect(result.command).toBe("/local-only");
  expect(result.content).toContain("Local content: now");
});

async function removeDirectoryWithRetry(directory: string): Promise<void> {
  for (let attempt = 0; attempt < 5; attempt += 1) {
    try {
      await rm(directory, { recursive: true, force: true });
      return;
    } catch (error) {
      if ((error as { code?: string }).code !== "EBUSY" || attempt === 4) {
        throw error;
      }
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
  }
}
