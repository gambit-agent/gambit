import path from "node:path";

const DEFAULT_PROJECT_DOC_MAX_BYTES = 64_000;
const DEFAULT_SLASH_COMMAND_CHAR_BUDGET = 15_000;
const DEFAULT_SKILL_CATALOG_CHAR_BUDGET = 8_000;

export let workspaceRoot = computeWorkspaceRoot(Bun.env.WORKSPACE_ROOT);
export const defaultModel = Bun.env.OPENROUTER_MODEL ?? "z-ai/glm-4.6";
export const refererHeader = Bun.env.OPENROUTER_REFERRER ?? "https://github.com/opentui/gambit";
export const titleHeader = Bun.env.OPENROUTER_TITLE ?? "Gambit TUI Agent";
export const freeModelPresets = ["z-ai/glm-4.6"] as const;

export const MAX_FILE_CHARS = 60_000;
export const MAX_SHELL_OUTPUT = 20_000;

export const projectDocMaxBytes = parseProjectDocMaxBytes(Bun.env.PROJECT_DOC_MAX_BYTES);
export const projectDocFallbackFilenames = parseProjectDocFallbacks(
  Bun.env.PROJECT_DOC_FALLBACK_FILENAMES,
);
export const slashCommandCharBudget = parseSlashCommandCharBudget(
  Bun.env.SLASH_COMMAND_TOOL_CHAR_BUDGET,
);
export const skillCatalogCharBudget = parseSkillCatalogCharBudget(
  Bun.env.SKILL_CATALOG_CHAR_BUDGET,
);

export function setWorkspaceRootForTesting(newRoot: string) {
  workspaceRoot = computeWorkspaceRoot(newRoot);
}

function computeWorkspaceRoot(root: string | undefined): string {
  return path.resolve(root ?? process.cwd());
}

function parseProjectDocMaxBytes(value: string | undefined): number {
  if (value === undefined) {
    return DEFAULT_PROJECT_DOC_MAX_BYTES;
  }
  const parsed = Number.parseInt(value, 10);
  if (Number.isNaN(parsed)) {
    return DEFAULT_PROJECT_DOC_MAX_BYTES;
  }
  return Math.max(0, parsed);
}

function parseProjectDocFallbacks(value: string | undefined): string[] {
  if (!value) {
    return [];
  }
  const unique = new Set(
    value
      .split(/[,;\n\r]+/)
      .map((entry) => entry.trim())
      .filter(Boolean),
  );
  return Array.from(unique);
}

function parseSlashCommandCharBudget(value: string | undefined): number {
  if (!value) {
    return DEFAULT_SLASH_COMMAND_CHAR_BUDGET;
  }
  const parsed = Number.parseInt(value, 10);
  if (Number.isNaN(parsed)) {
    return DEFAULT_SLASH_COMMAND_CHAR_BUDGET;
  }
  return Math.max(0, parsed);
}

function parseSkillCatalogCharBudget(value: string | undefined): number {
  if (!value) {
    return DEFAULT_SKILL_CATALOG_CHAR_BUDGET;
  }
  const parsed = Number.parseInt(value, 10);
  if (Number.isNaN(parsed)) {
    return DEFAULT_SKILL_CATALOG_CHAR_BUDGET;
  }
  return Math.max(0, parsed);
}
