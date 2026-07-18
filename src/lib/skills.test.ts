import { afterEach, beforeEach, expect, test } from "bun:test";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { setWorkspaceRootForTesting, workspaceRoot as originalWorkspaceRoot } from "../config";
import {
  activateSkill,
  buildActivateSkillToolDescription,
  loadSkills,
  setSkillDirectoriesForTesting,
} from "./skills";

let workspaceDir: string;
let userRoot: string;
let projectSkillsDir: string;
let userSkillsDir: string;
let originalWorkspaceRootEnv: string | undefined;

beforeEach(async () => {
  workspaceDir = await mkdtemp(path.join(tmpdir(), "gambit-skills-project-"));
  userRoot = await mkdtemp(path.join(tmpdir(), "gambit-skills-user-"));
  projectSkillsDir = path.join(workspaceDir, ".gambit", "skills");
  userSkillsDir = path.join(userRoot, ".gambit", "skills");

  await mkdir(projectSkillsDir, { recursive: true });
  await mkdir(userSkillsDir, { recursive: true });

  originalWorkspaceRootEnv = process.env.WORKSPACE_ROOT;
  process.env.WORKSPACE_ROOT = workspaceDir;
  setWorkspaceRootForTesting(workspaceDir);
  setSkillDirectoriesForTesting({ project: projectSkillsDir, user: userSkillsDir });
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
  setSkillDirectoriesForTesting({ project: null, user: null });
});

test("discovers project and user skills with frontmatter metadata", async () => {
  await mkdir(path.join(projectSkillsDir, "pdf-processing"), { recursive: true });
  await writeFile(
    path.join(projectSkillsDir, "pdf-processing", "SKILL.md"),
    [
      "---",
      "name: pdf-processing",
      "description: Extract PDF text, fill forms, merge files. Use when handling PDFs.",
      "license: Apache-2.0",
      "---",
      "",
      "Load pdfplumber for text extraction.",
      "",
    ].join("\n"),
  );

  await mkdir(path.join(userSkillsDir, "data-analysis"), { recursive: true });
  await writeFile(
    path.join(userSkillsDir, "data-analysis", "SKILL.md"),
    [
      "---",
      "name: data-analysis",
      "description: Analyze datasets and produce summary charts.",
      "---",
      "",
      "Use pandas for aggregation.",
      "",
    ].join("\n"),
  );

  const skills = await loadSkills();
  expect(skills.map((skill) => skill.name)).toEqual(["data-analysis", "pdf-processing"]);

  const pdf = skills.find((skill) => skill.name === "pdf-processing");
  expect(pdf?.scope).toBe("project");
  expect(pdf?.description).toBe("Extract PDF text, fill forms, merge files. Use when handling PDFs.");
  expect(pdf?.license).toBe("Apache-2.0");
  expect(pdf?.body).toContain("Load pdfplumber");

  const analysis = skills.find((skill) => skill.name === "data-analysis");
  expect(analysis?.scope).toBe("user");

  const description = buildActivateSkillToolDescription(skills);
  expect(description).toContain("pdf-processing");
  expect(description).toContain("(project)");
  expect(description).toContain("data-analysis");
  expect(description).toContain("(user)");
});

test("skips skills without a description", async () => {
  await mkdir(path.join(projectSkillsDir, "no-description"), { recursive: true });
  await writeFile(
    path.join(projectSkillsDir, "no-description", "SKILL.md"),
    ["---", "name: no-description", "---", "body without description"].join("\n"),
  );

  const skills = await loadSkills();
  expect(skills).toHaveLength(0);
});

test("project-scoped skills shadow user-scoped skills with the same name", async () => {
  await mkdir(path.join(projectSkillsDir, "deploy"), { recursive: true });
  await writeFile(
    path.join(projectSkillsDir, "deploy", "SKILL.md"),
    ["---", "name: deploy", "description: Project-specific deploy skill.", "---", "project body"].join("\n"),
  );

  await mkdir(path.join(userSkillsDir, "deploy"), { recursive: true });
  await writeFile(
    path.join(userSkillsDir, "deploy", "SKILL.md"),
    ["---", "name: deploy", "description: User deploy skill.", "---", "user body"].join("\n"),
  );

  const skills = await loadSkills();
  const deploy = skills.filter((skill) => skill.name === "deploy");
  expect(deploy).toHaveLength(1);
  expect(deploy[0]?.scope).toBe("project");
  expect(deploy[0]?.body).toContain("project body");
});

test("activateSkill returns skill body wrapped with metadata and resource listing", async () => {
  const skillDir = path.join(projectSkillsDir, "pdf-processing");
  await mkdir(path.join(skillDir, "scripts"), { recursive: true });
  await mkdir(path.join(skillDir, "references"), { recursive: true });

  await writeFile(
    path.join(skillDir, "SKILL.md"),
    [
      "---",
      "name: pdf-processing",
      "description: Extract PDF text and fill forms.",
      "---",
      "",
      "# PDF Processing",
      "Use pdfplumber for extraction.",
    ].join("\n"),
  );
  await writeFile(path.join(skillDir, "scripts", "extract.py"), "print('hello')\n");
  await writeFile(path.join(skillDir, "references", "spec.md"), "spec content");

  const activation = await activateSkill("pdf-processing");
  expect(activation.name).toBe("pdf-processing");
  expect(activation.scope).toBe("project");
  expect(activation.resources).toEqual(["references/spec.md", "scripts/extract.py"].sort());
  expect(activation.content).toContain('<skill_content name="pdf-processing" scope="project">');
  expect(activation.content).toContain("# PDF Processing");
  expect(activation.content).toContain("Use pdfplumber");
  expect(activation.content).toContain("<skill_resources>");
  expect(activation.content).toContain("<file>scripts/extract.py</file>");
  expect(activation.content).toContain("<file>references/spec.md</file>");
  expect(activation.content).toContain(`Skill directory: ${skillDir}`);
});

test("activateSkill throws a helpful error when skill is missing", async () => {
  await mkdir(path.join(projectSkillsDir, "other"), { recursive: true });
  await writeFile(
    path.join(projectSkillsDir, "other", "SKILL.md"),
    ["---", "name: other", "description: Other skill.", "---", "body"].join("\n"),
  );

  await expect(activateSkill("missing")).rejects.toThrow(/Skill not found: missing/);
  await expect(activateSkill("missing")).rejects.toThrow(/other/);
});

test("buildActivateSkillToolDescription reports empty catalog without crashing", () => {
  const description = buildActivateSkillToolDescription([]);
  expect(description).toContain("No skills are currently installed.");
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
