import { readdir } from "node:fs/promises";
import { homedir } from "node:os";
import path from "node:path";
import { Glob } from "bun";

import { skillCatalogCharBudget, workspaceRoot } from "../config";
import { parseFrontmatter, parseFrontmatterList } from "./frontmatter";
import { truncate } from "./text";

export type SkillScope = "project" | "user";

export interface SkillDefinition {
  /** Skill name (matches the parent directory name). */
  name: string;
  /** One-line description used in the catalog. */
  description: string;
  scope: SkillScope;
  /** Absolute path to the SKILL.md file. */
  filePath: string;
  /** Absolute path to the skill's root directory. */
  directoryPath: string;
  /** Markdown body after the frontmatter (trimmed). */
  body: string;
  license?: string;
  compatibility?: string;
  allowedTools?: string[];
}

export interface SkillActivation {
  name: string;
  scope: SkillScope;
  directoryPath: string;
  body: string;
  resources: string[];
  /** Rendered tool-result payload (what is returned to the model). */
  content: string;
}

interface Frontmatter {
  name?: string;
  description?: string;
  license?: string;
  compatibility?: string;
  allowedTools?: string[];
}

let projectSkillDirsOverride: string[] | null = null;
let userSkillDirsOverride: string[] | null = null;

function getProjectSkillDirs(): string[] {
  if (projectSkillDirsOverride) {
    return projectSkillDirsOverride;
  }
  return [
    path.join(workspaceRoot, ".gambit", "skills"),
    path.join(workspaceRoot, ".agents", "skills"),
  ];
}

function getUserSkillDirs(): string[] {
  if (userSkillDirsOverride) {
    return userSkillDirsOverride;
  }
  return [
    path.join(homedir(), ".gambit", "skills"),
    path.join(homedir(), ".agents", "skills"),
  ];
}

export function getSkillDirectories(): string[] {
  return [...getProjectSkillDirs(), ...getUserSkillDirs()];
}

export function setSkillDirectoriesForTesting(options: {
  project?: string | string[] | null;
  user?: string | string[] | null;
}) {
  if (Object.prototype.hasOwnProperty.call(options, "project")) {
    projectSkillDirsOverride = normalizeDirOverride(options.project);
  }
  if (Object.prototype.hasOwnProperty.call(options, "user")) {
    userSkillDirsOverride = normalizeDirOverride(options.user);
  }
}

function normalizeDirOverride(value: string | string[] | null | undefined): string[] | null {
  if (value === null || value === undefined) {
    return null;
  }
  if (Array.isArray(value)) {
    return value.slice();
  }
  return [value];
}

export async function loadSkills(): Promise<SkillDefinition[]> {
  const [projectSkillGroups, userSkillGroups] = await Promise.all([
    Promise.all(getProjectSkillDirs().map((dir) => collectSkills(dir, "project"))),
    Promise.all(getUserSkillDirs().map((dir) => collectSkills(dir, "user"))),
  ]);
  const projectSkills = projectSkillGroups.flat();
  const userSkills = userSkillGroups.flat();

  const deduplicatedProject = dedupeByName(projectSkills);
  const projectNames = new Set(deduplicatedProject.map((skill) => skill.name));
  const filteredUser = userSkills.filter((skill) => !projectNames.has(skill.name));
  const deduplicatedUser = dedupeByName(filteredUser);

  const skills = [...deduplicatedProject, ...deduplicatedUser];
  skills.sort((a, b) => a.name.localeCompare(b.name));
  return skills;
}

export async function activateSkill(name: string): Promise<SkillActivation> {
  const trimmed = name.trim();
  if (!trimmed) {
    throw new Error("Skill name cannot be empty.");
  }

  const skills = await loadSkills();
  const skill = skills.find((candidate) => candidate.name === trimmed);
  if (!skill) {
    const available = skills.map((candidate) => candidate.name).join(", ") || "(none)";
    throw new Error(`Skill not found: ${trimmed}. Available skills: ${available}`);
  }

  const resources = await listSkillResources(skill.directoryPath);
  const content = renderSkillContent(skill, resources);

  return {
    name: skill.name,
    scope: skill.scope,
    directoryPath: skill.directoryPath,
    body: skill.body,
    resources,
    content,
  };
}

export function buildActivateSkillToolDescription(skills: SkillDefinition[]): string {
  const header = [
    "Activate an installed Agent Skill when a task matches its catalog description.",
    "Skills are discovered from `.gambit/skills/` and `.agents/skills/` at the project and user scope.",
    "Call this with the exact `name` listed below.",
    "The tool returns the skill's SKILL.md instructions and bundled resource paths to read only as needed.",
  ].join(" ");

  if (skills.length === 0) {
    return `${header}\nNo skills are currently installed.`;
  }

  const lines: string[] = [];
  for (const skill of skills) {
    const scopeLabel = skill.scope === "project" ? "project" : "user";
    lines.push(`- ${skill.name} (${scopeLabel}) — ${skill.description}`);
  }

  const budget = Math.max(0, skillCatalogCharBudget);
  const segments = [header, "Available skills:", ...lines];

  if (budget === 0) {
    return header;
  }

  const assembled = assembleWithBudget(segments, budget);
  if (assembled === null) {
    return truncate([header, "Available skills:", lines[0] ?? ""].join("\n"), budget);
  }
  return assembled;
}

function assembleWithBudget(lines: string[], budget: number): string | null {
  let used = 0;
  const included: string[] = [];
  let truncatedFlag = false;

  for (const line of lines) {
    const nextLength = line.length + (included.length === 0 ? 0 : 1);
    if (used + nextLength > budget) {
      truncatedFlag = true;
      break;
    }
    included.push(line);
    used += nextLength;
  }

  if (included.length === 0) {
    return null;
  }

  if (!truncatedFlag) {
    return included.join("\n");
  }

  const remaining = lines.length - included.length;
  const note = `\n… (${remaining} more skill${remaining === 1 ? "" : "s"})`;
  const candidate = included.join("\n") + note;
  if (candidate.length <= budget) {
    return candidate;
  }
  return truncate(candidate, budget);
}

async function collectSkills(root: string, scope: SkillScope): Promise<SkillDefinition[]> {
  const skillFiles: string[] = [];

  try {
    const skillGlob = new Glob("*/SKILL.md");
    for await (const filePath of skillGlob.scan({
      cwd: root,
      dot: true,
      absolute: true,
      onlyFiles: true,
      followSymlinks: false,
    })) {
      skillFiles.push(filePath);
    }
  } catch {
    return [];
  }

  const skills = await Promise.all(skillFiles.map(async (skillFile) => {
    const skillDir = path.dirname(skillFile);
    const directoryName = path.basename(skillDir);
    return parseSkillFile(skillFile, directoryName, skillDir, scope);
  }));
  return skills.filter((definition): definition is SkillDefinition => definition !== null);
}

async function parseSkillFile(
  filePath: string,
  directoryName: string,
  directoryPath: string,
  scope: SkillScope,
): Promise<SkillDefinition | null> {
  const file = Bun.file(filePath);
  if (!(await file.exists())) {
    return null;
  }

  const content = await file.text();
  const { frontmatter, body } = extractFrontmatter(content);

  const description = frontmatter.description?.trim();
  if (!description) {
    console.warn(`Skipping skill at ${filePath}: missing 'description' in frontmatter.`);
    return null;
  }

  const name = (frontmatter.name ?? directoryName).trim();
  if (!name) {
    console.warn(`Skipping skill at ${filePath}: skill name cannot be empty.`);
    return null;
  }

  if (frontmatter.name && frontmatter.name !== directoryName) {
    console.warn(
      `Skill at ${filePath} has frontmatter name "${frontmatter.name}" that does not match directory "${directoryName}"; using frontmatter name.`,
    );
  }

  return {
    name,
    description,
    scope,
    filePath,
    directoryPath,
    body: body.trim(),
    license: frontmatter.license,
    compatibility: frontmatter.compatibility,
    allowedTools: frontmatter.allowedTools,
  };
}

function extractFrontmatter(content: string): { frontmatter: Frontmatter; body: string } {
  const { values, body } = parseFrontmatter(content);
  const frontmatter: Frontmatter = {};

  for (const [key, value] of Object.entries(values)) {
    switch (key) {
      case "name":
        frontmatter.name = value;
        break;
      case "description":
        frontmatter.description = value;
        break;
      case "license":
        frontmatter.license = value;
        break;
      case "compatibility":
        frontmatter.compatibility = value;
        break;
      case "allowed-tools":
        frontmatter.allowedTools = parseFrontmatterList(value);
        break;
      default:
        break;
    }
  }

  return { frontmatter, body };
}

function dedupeByName(skills: SkillDefinition[]): SkillDefinition[] {
  const seen = new Set<string>();
  const out: SkillDefinition[] = [];
  for (const skill of skills) {
    if (seen.has(skill.name)) {
      console.warn(
        `Duplicate skill name "${skill.name}" found at ${skill.filePath}; ignoring the later entry.`,
      );
      continue;
    }
    seen.add(skill.name);
    out.push(skill);
  }
  return out;
}

const RESOURCE_SKIP_DIRECTORIES = new Set([".git", "node_modules"]);
const RESOURCE_MAX_ENTRIES = 100;
const RESOURCE_MAX_DEPTH = 4;

async function listSkillResources(directoryPath: string): Promise<string[]> {
  const out: string[] = [];

  async function walk(dir: string, relative: string, depth: number): Promise<void> {
    if (out.length >= RESOURCE_MAX_ENTRIES || depth > RESOURCE_MAX_DEPTH) {
      return;
    }
    let entries;
    try {
      entries = await readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (out.length >= RESOURCE_MAX_ENTRIES) {
        return;
      }
      if (entry.name.startsWith(".")) {
        continue;
      }
      if (entry.isDirectory() && RESOURCE_SKIP_DIRECTORIES.has(entry.name)) {
        continue;
      }
      const nextRelative = relative ? path.join(relative, entry.name) : entry.name;
      if (entry.isDirectory()) {
        await walk(path.join(dir, entry.name), nextRelative, depth + 1);
        continue;
      }
      if (!entry.isFile()) {
        continue;
      }
      if (nextRelative === "SKILL.md") {
        continue;
      }
      out.push(nextRelative.split(path.sep).join("/"));
    }
  }

  await walk(directoryPath, "", 0);
  out.sort();
  return out;
}

function renderSkillContent(skill: SkillDefinition, resources: string[]): string {
  const parts: string[] = [];
  parts.push(`<skill_content name="${escapeAttribute(skill.name)}" scope="${skill.scope}">`);
  if (skill.compatibility) {
    parts.push(`Compatibility: ${skill.compatibility}`);
    parts.push("");
  }
  parts.push(skill.body || "(empty skill body)");
  parts.push("");
  parts.push(`Skill directory: ${skill.directoryPath}`);
  parts.push(
    "Files referenced by this skill use paths relative to the skill directory. Use the `read` tool with the full absolute path when loading them. Skill scripts may be run with `bash` by absolute path after inspecting them.",
  );
  if (resources.length > 0) {
    parts.push("");
    parts.push("<skill_resources>");
    for (const resource of resources) {
      parts.push(`  <file>${resource}</file>`);
    }
    if (resources.length >= RESOURCE_MAX_ENTRIES) {
      parts.push("  <!-- resource listing truncated -->");
    }
    parts.push("</skill_resources>");
  }
  parts.push("</skill_content>");
  return parts.join("\n");
}

function escapeAttribute(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}
