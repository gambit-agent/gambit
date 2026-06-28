import { afterEach, beforeEach, expect, test } from "bun:test";
import { chmod, mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { setWorkspaceRootForTesting, workspaceRoot } from "../config";
import { setSkillDirectoriesForTesting } from "../lib/skills";
import { createAgentToolMap, createRuntimeToolSuite, type AgentTools } from "./index";

let workspaceDir: string;
let userSkillsDir: string;
let originalWorkspaceRootEnv: string | undefined;
let originalWorkspaceRootValue: string;
let agentTools: AgentTools;

beforeEach(async () => {
  workspaceDir = await mkdtemp(path.join(tmpdir(), "gambit-tools-"));
  userSkillsDir = await mkdtemp(path.join(tmpdir(), "gambit-tools-user-skills-"));
  originalWorkspaceRootEnv = process.env.WORKSPACE_ROOT;
  originalWorkspaceRootValue = workspaceRoot;
  process.env.WORKSPACE_ROOT = workspaceDir;
  setWorkspaceRootForTesting(workspaceDir);
  setSkillDirectoriesForTesting({ project: [], user: userSkillsDir });
  agentTools = await createAgentToolMap({ workspaceRoot: workspaceDir, includeMCPTools: false });
});

afterEach(async () => {
  await rm(workspaceDir, { recursive: true, force: true });
  await rm(userSkillsDir, { recursive: true, force: true });
  if (originalWorkspaceRootEnv === undefined) {
    delete process.env.WORKSPACE_ROOT;
  } else {
    process.env.WORKSPACE_ROOT = originalWorkspaceRootEnv;
  }
  setWorkspaceRootForTesting(originalWorkspaceRootValue);
  setSkillDirectoriesForTesting({ project: null, user: null });
});

test("read rejects missing path", async () => {
  await expect(agentTools.read.execute({} as any)).rejects.toThrow('"path"');
});

test("read can read absolute paths inside user skill directories", async () => {
  const resourcePath = path.join(userSkillsDir, "example", "references", "notes.md");
  await mkdir(path.dirname(resourcePath), { recursive: true });
  await writeFile(resourcePath, "skill notes");

  await expect(agentTools.read.execute({ path: resourcePath })).resolves.toContain("1: skill notes");
});

test("read can page file contents with line numbers", async () => {
  await writeFile(path.join(workspaceDir, "notes.txt"), "one\ntwo\nthree\nfour\n");

  const output = String(await agentTools.read.execute({ path: "notes.txt", offset: 2, limit: 2 }));

  expect(output).toContain("<type>file</type>");
  expect(output).toContain("2: two");
  expect(output).toContain("3: three");
  expect(output).not.toContain("4: four");
  expect(output).toContain("Use offset=4 to continue");
});

test("read can list directories", async () => {
  await mkdir(path.join(workspaceDir, "src", "nested"), { recursive: true });
  await writeFile(path.join(workspaceDir, "src", "index.ts"), "export {}\n");

  const output = String(await agentTools.read.execute({ path: "src" }));

  expect(output).toContain("<type>directory</type>");
  expect(output).toContain("index.ts");
  expect(output).toContain("nested/");
});

test("read rejects arbitrary absolute paths outside workspace and skill directories", async () => {
  const outsideDir = await mkdtemp(path.join(tmpdir(), "gambit-tools-outside-"));
  try {
    await expect(agentTools.read.execute({ path: path.join(outsideDir, "secret.txt") })).rejects.toThrow(
      "Access denied",
    );
  } finally {
    await rm(outsideDir, { recursive: true, force: true });
  }
});

test("bash can run scripts from absolute paths inside user skill directories", async () => {
  const scriptPath = path.join(userSkillsDir, "example", "scripts", "hello.sh");
  await mkdir(path.dirname(scriptPath), { recursive: true });
  await writeFile(scriptPath, "printf 'hello from skill script\\n'");
  await chmod(scriptPath, 0o755);

  const output = await agentTools.bash.execute({ command: scriptPath });
  expect(output).toContain("exit_code: 0");
  expect(output).toContain("hello from skill script");
});

test("bash can run in a workspace-relative workdir", async () => {
  await mkdir(path.join(workspaceDir, "pkg"), { recursive: true });
  await writeFile(path.join(workspaceDir, "pkg", "package.txt"), "pkg\n");

  const output = String(await agentTools.bash.execute({ command: "pwd && cat package.txt", workdir: "pkg" }));

  expect(output).toContain("exit_code: 0");
  expect(output).toContain(path.join(workspaceDir, "pkg"));
  expect(output).toContain("pkg");
});

test("glob and grep expose split search primitives", async () => {
  await mkdir(path.join(workspaceDir, "src"), { recursive: true });
  await writeFile(path.join(workspaceDir, "src", "app.ts"), "export const needle = true\n");
  await writeFile(path.join(workspaceDir, "src", "app.test.ts"), "expect(needle).toBe(true)\n");

  const globOutput = String(await agentTools.glob.execute({ pattern: "**/*.test.ts" }));
  const grepOutput = String(await agentTools.grep.execute({ pattern: "needle", path: "src" }));

  expect(globOutput).toContain("src/app.test.ts");
  expect(grepOutput).toContain("app.ts");
  expect(grepOutput).toContain("needle");
});

test("edit replaces a unique oldString and rejects ambiguous matches", async () => {
  const target = path.join(workspaceDir, "edit.txt");
  await writeFile(target, "alpha\nbeta\nalpha\n");

  await expect(
    agentTools.edit.execute({ path: "edit.txt", oldString: "alpha", newString: "ALPHA" }),
  ).rejects.toThrow("multiple matches");

  const output = String(
    await agentTools.edit.execute({
      path: "edit.txt",
      oldString: "beta",
      newString: "BETA",
    }),
  );

  expect(output).toContain("Edited edit.txt");
  expect(await readFile(target, "utf8")).toBe("alpha\nBETA\nalpha\n");
});

test("write rejects non-string content", async () => {
  await expect(
    agentTools.write.execute({ path: "file.txt", content: undefined as any }),
  ).rejects.toThrow('"content"');
});

test("bash rejects non-string command", async () => {
  await expect(agentTools.bash.execute({ command: undefined as any })).rejects.toThrow(
    '"command"',
  );
});

test("legacy tool ids remain executable for compatibility", async () => {
  await writeFile(path.join(workspaceDir, "legacy.txt"), "legacy content\n");
  const { executor } = await createRuntimeToolSuite({
    workspaceRoot: workspaceDir,
    includeMCPTools: false,
    includeSpawnAgent: false,
  });

  const readResult = await executor.execute("readFile", { path: "legacy.txt" }, { workspaceRoot: workspaceDir });
  expect(String(readResult.output)).toContain("1: legacy content");

  const shellResult = await executor.execute("executeShell", { command: "printf legacy" }, { workspaceRoot: workspaceDir });
  expect(String(shellResult.output)).toContain("legacy");
});
