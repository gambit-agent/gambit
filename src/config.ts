import path from "node:path";

const DEFAULT_PROJECT_DOC_MAX_BYTES = 64_000;
const DEFAULT_SLASH_COMMAND_CHAR_BUDGET = 15_000;
const DEFAULT_SKILL_CATALOG_CHAR_BUDGET = 8_000;
const DEFAULT_MAX_AGENT_STEPS = 200;

/**
 * Absolute path to the active workspace root. Defaults to `process.cwd()` but
 * can be overridden via the `WORKSPACE_ROOT` environment variable.
 */
export let workspaceRoot = computeWorkspaceRoot(Bun.env.WORKSPACE_ROOT);

/** Optional default LLM identifier supplied by environment configuration. */
export const defaultModel = Bun.env.GAMBIT_MODEL?.trim() || Bun.env.OPENROUTER_MODEL?.trim() || null;

/** HTTP Referer header sent to OpenRouter for attribution. */
export const refererHeader = Bun.env.OPENROUTER_REFERRER ?? "https://github.com/opentui/gambit";

/** X-Title header sent to OpenRouter. */
export const titleHeader = Bun.env.OPENROUTER_TITLE ?? "Gambit TUI Agent";

/** Presets shown when the user wants a free/cheap model option. */
export const freeModelPresets = ["qwen/qwen3.6-plus"] as const;

/** Presets shown when the user wants a Codex subscription model. */
export const codexModelPresets = ["codex/gpt-5.1-codex", "codex/gpt-5-codex"] as const;

/** Maximum characters to read from a single file before truncation. */
export const MAX_FILE_CHARS = 60_000;

/** Maximum characters of shell output to inline before truncation or artifact storage. */
export const MAX_SHELL_OUTPUT = 20_000;

/** Fallback context window when provider metadata is unavailable. */
export const DEFAULT_MODEL_CONTEXT_LENGTH = 128_000;

/** Maximum characters of tool output to inline before writing an artifact. */
export const MAX_INLINE_TOOL_RESULT_CHARS = 8_000;

/** Timeout for fetching model metadata from OpenRouter. */
export const MODEL_METADATA_TIMEOUT_MS = 10_000;

/** Parsed byte limit for the project-doc prompt fragment. */
export const projectDocMaxBytes = parseProjectDocMaxBytes(Bun.env.PROJECT_DOC_MAX_BYTES);

/** Fallback filenames scanned for project docs when no explicit doc is provided. */
export const projectDocFallbackFilenames = parseProjectDocFallbacks(
  Bun.env.PROJECT_DOC_FALLBACK_FILENAMES,
);

/** Character budget for embedding slash-command definitions into the system prompt. */
export const slashCommandCharBudget = parseSlashCommandCharBudget(
  Bun.env.SLASH_COMMAND_TOOL_CHAR_BUDGET,
);

/** Character budget for the skill catalog embedded in the `activateSkill` tool description. */
export const skillCatalogCharBudget = parseSkillCatalogCharBudget(
  Bun.env.SKILL_CATALOG_CHAR_BUDGET,
);

/** Maximum model/tool loop steps per agent turn. */
export const maxAgentSteps = parseMaxAgentSteps(Bun.env.GAMBIT_MAX_AGENT_STEPS);

/** Maximum inline characters for aggregated delegated-agent output. */
export const MAX_AGENT_BATCH_INLINE_OUTPUT_CHARS = 12_000;

/** Response spinner cadence used by the interactive REPL footer. */
export const RESPONSE_SPINNER_INTERVAL_MS = 80;

/** Maximum time between Esc presses before the interactive rewind is cancelled. */
export const DOUBLE_ESC_INTERVAL_MS = 400;

/** Frames used by the interactive REPL response spinner. */
export const responseSpinnerFrames = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"] as const;

/** Override the workspace root at test time so tests run in a temp directory. */
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

function parseMaxAgentSteps(value: string | undefined): number {
  if (!value) {
    return DEFAULT_MAX_AGENT_STEPS;
  }
  const parsed = Number.parseInt(value, 10);
  if (Number.isNaN(parsed)) {
    return DEFAULT_MAX_AGENT_STEPS;
  }
  return Math.max(1, parsed);
}
