import { afterEach, expect, test } from "bun:test";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import {
  DEFAULT_PROJECT_DOC_FILENAME,
  discoverProjectDocPaths,
  readProjectDocs,
} from "./projectDocs";

const cleanupDirs: string[] = [];

afterEach(async () => {
  while (cleanupDirs.length > 0) {
    const dir = cleanupDirs.pop();
    if (!dir) {
      continue;
    }
    await rm(dir, { recursive: true, force: true });
  }
});

test("returns null when no project docs are present", async () => {
  const workspace = await createTempDir();
  const options = { cwd: workspace, maxBytes: 4_096, fallbackFilenames: [] as const };

  expect(await readProjectDocs(options)).toBeNull();
  expect(await discoverProjectDocPaths(options)).toEqual([]);
});

test("returns document when within byte limit", async () => {
  const workspace = await createTempDir();
  await writeFile(path.join(workspace, DEFAULT_PROJECT_DOC_FILENAME), "hello world");

  const options = { cwd: workspace, maxBytes: 4_096, fallbackFilenames: [] as const };
  expect(await readProjectDocs(options)).toBe("hello world");
});

test("truncates document that exceeds byte budget", async () => {
  const workspace = await createTempDir();
  await writeFile(path.join(workspace, DEFAULT_PROJECT_DOC_FILENAME), "A".repeat(32));

  const options = { cwd: workspace, maxBytes: 10, fallbackFilenames: [] as const };
  const docs = await readProjectDocs(options);
  expect(docs).not.toBeNull();
  expect(docs!.length).toBe(10);
  expect(docs).toBe("A".repeat(10));
});

test("concatenates docs from git root to working directory", async () => {
  const repoRoot = await createTempDir();
  await writeFile(path.join(repoRoot, ".git"), "gitdir: /tmp/mock\n");
  await writeFile(path.join(repoRoot, DEFAULT_PROJECT_DOC_FILENAME), "root doc");

  const nested = path.join(repoRoot, "workspace", "package");
  await mkdir(nested, { recursive: true });
  await writeFile(path.join(nested, DEFAULT_PROJECT_DOC_FILENAME), "package doc");

  const options = { cwd: nested, maxBytes: 4_096, fallbackFilenames: [] as const };

  const discovered = await discoverProjectDocPaths(options);
  expect(discovered).toEqual([
    path.join(repoRoot, DEFAULT_PROJECT_DOC_FILENAME),
    path.join(nested, DEFAULT_PROJECT_DOC_FILENAME),
  ]);

  expect(await readProjectDocs(options)).toBe("root doc\n\npackage doc");
});

test("uses fallback filenames when AGENTS.md missing", async () => {
  const workspace = await createTempDir();
  await writeFile(path.join(workspace, "GUIDE.md"), "fallback text");

  const options = { cwd: workspace, maxBytes: 4_096, fallbackFilenames: ["GUIDE.md"] as const };
  expect(await readProjectDocs(options)).toBe("fallback text");
});

test("prefers AGENTS.md over fallback files", async () => {
  const workspace = await createTempDir();
  await writeFile(path.join(workspace, DEFAULT_PROJECT_DOC_FILENAME), "primary doc");
  await writeFile(path.join(workspace, "GUIDE.md"), "secondary doc");

  const options = { cwd: workspace, maxBytes: 4_096, fallbackFilenames: ["GUIDE.md"] as const };

  const discovered = await discoverProjectDocPaths(options);
  expect(discovered).toEqual([path.join(workspace, DEFAULT_PROJECT_DOC_FILENAME)]);
  expect(await readProjectDocs(options)).toBe("primary doc");
});

test("returns null when max bytes set to zero", async () => {
  const workspace = await createTempDir();
  await writeFile(path.join(workspace, DEFAULT_PROJECT_DOC_FILENAME), "ignored");

  const options = { cwd: workspace, maxBytes: 0, fallbackFilenames: [] as const };
  expect(await readProjectDocs(options)).toBeNull();
  expect(await discoverProjectDocPaths(options)).toEqual([]);
});

async function createTempDir() {
  const dir = await mkdtemp(path.join(tmpdir(), "gambit-docs-"));
  cleanupDirs.push(dir);
  return dir;
}
