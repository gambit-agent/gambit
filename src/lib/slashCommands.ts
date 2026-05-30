import { readdir } from "node:fs/promises";
import { homedir } from "node:os";
import path from "node:path";

import { MAX_SHELL_OUTPUT, slashCommandCharBudget, workspaceRoot } from "../config";
import { truncate } from "./text";

interface Frontmatter {
  description?: string;
  argumentHint?: string;
  allowedTools?: string[];
  model?: string;
  disableModelInvocation?: boolean;
}

export type SlashCommandScope = "project" | "user";

export interface SlashCommandDefinition {
  /** Identifier used to reference the command. Includes namespace when present. */
  id: string;
  /** Base command name derived from the filename without extension. */
  name: string;
  /** Optional namespace derived from subdirectories. */
  namespace: string | null;
  scope: SlashCommandScope;
  description: string | null;
  argumentHint?: string;
  allowedTools: string[];
  model?: string;
  disableModelInvocation: boolean;
  filePath: string;
  relativePath: string;
  body: string;
}

export interface SlashCommandExecution {
  command: string;
  scope: SlashCommandScope;
  namespace: string | null;
  arguments: string;
  allowedTools: string[];
  model?: string;
  content: string;
}

const INLINE_COMMAND_PATTERN = /!`([^`]+?)`/g;

let projectCommandsDirOverride: string | null = null;
let userCommandsDirOverride: string | null = null;

function getProjectCommandsDir() {
  return projectCommandsDirOverride ?? path.join(workspaceRoot, ".gambit", "commands");
}

function getUserCommandsDir() {
  return userCommandsDirOverride ?? path.join(homedir(), ".gambit", "commands");
}

export function setSlashCommandDirectoriesForTesting(options: {
  project?: string | null;
  user?: string | null;
}) {
  if (Object.prototype.hasOwnProperty.call(options, "project")) {
    projectCommandsDirOverride = options.project ?? null;
  }
  if (Object.prototype.hasOwnProperty.call(options, "user")) {
    userCommandsDirOverride = options.user ?? null;
  }
}

export async function loadSlashCommands(): Promise<SlashCommandDefinition[]> {
  const projectDir = getProjectCommandsDir();
  const userDir = getUserCommandsDir();

  const projectCommands = await collectCommands(projectDir, "project", projectDir);
  const userCommands = await collectCommands(userDir, "user", userDir);

  const commands = [...projectCommands, ...filterUserConflicts(projectCommands, userCommands)];
  commands.sort((a, b) => a.id.localeCompare(b.id));
  return commands;
}

export async function executeSlashCommand(
  identifier: string,
  args: string | undefined,
  options: { allowDisabledModelInvocation?: boolean } = {},
): Promise<SlashCommandExecution> {
  const trimmed = identifier.replace(/^\//, "").trim();
  if (!trimmed) {
    throw new Error("Slash command name cannot be empty.");
  }

  const commands = await loadSlashCommands();
  const command = resolveCommand(commands, trimmed);
  if (!command) {
    throw new Error(`Slash command not found: /${trimmed}`);
  }

  if (command.disableModelInvocation && !options.allowDisabledModelInvocation) {
    throw new Error(`Slash command /${command.id} is disabled for model invocation.`);
  }

  const argumentText = args?.trim() ?? "";
  const contentWithArgs = applyArguments(command.body, argumentText);
  const rendered = await renderEmbeddedCommands(contentWithArgs);

  return {
    command: `/${command.id}`,
    scope: command.scope,
    namespace: command.namespace,
    arguments: argumentText,
    allowedTools: command.allowedTools,
    model: command.model,
    content: rendered.trim(),
  };
}

export function buildSlashCommandToolDescription(commands: SlashCommandDefinition[]): string {
  const header =
    "Execute a custom slash command defined in the workspace (.gambit/commands) or ~/.gambit/commands.";

  const eligible = commands.filter((command) => !command.disableModelInvocation && Boolean(command.description));
  if (eligible.length === 0) {
    return `${header}\nNo slash commands with descriptions were found.`;
  }

  const lines: string[] = [];
  const budget = Math.max(0, slashCommandCharBudget);

  for (const command of eligible) {
    const scopeLabel = command.scope === "project" ? "project" : "user";
    const namespaceLabel = command.namespace ? `${scopeLabel}:${command.namespace}` : scopeLabel;
    const argumentHint = command.argumentHint ? ` [args: ${command.argumentHint}]` : "";
    const allowedTools = command.allowedTools.length ? ` [tools: ${command.allowedTools.join(", ")}]` : "";
    const line = `/${command.id}${argumentHint} — ${command.description} (${namespaceLabel})${allowedTools}`;
    lines.push(line);
  }

  const full = [header, "Available commands:", ...lines];
  if (budget === 0) {
    return header;
  }

  const assembled = assembleWithBudget(full, budget);
  if (assembled === null) {
    return truncate([header, "Available commands:", lines[0]].join("\n"), budget);
  }
  return assembled;
}

function assembleWithBudget(lines: string[], budget: number): string | null {
  let used = 0;
  const included: string[] = [];
  let truncated = false;

  for (const line of lines) {
    const nextLength = line.length + (included.length === 0 ? 0 : 1);
    if (used + nextLength > budget) {
      truncated = true;
      break;
    }
    included.push(line);
    used += nextLength;
  }

  if (included.length === 0) {
    return null;
  }

  if (!truncated) {
    return included.join("\n");
  }

  const note = `\n… (${lines.length - included.length} more commands)`;
  const candidate = included.join("\n") + note;
  if (candidate.length <= budget) {
    return candidate;
  }
  return truncate(candidate, budget);
}

async function collectCommands(
  dir: string,
  scope: SlashCommandScope,
  rootDir: string,
): Promise<SlashCommandDefinition[]> {
  const commands: SlashCommandDefinition[] = [];
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return commands;
  }

  for (const entry of entries) {
    const entryPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      const nested = await collectCommands(entryPath, scope, rootDir);
      commands.push(...nested);
      continue;
    }
    if (!entry.isFile()) {
      continue;
    }
    if (!entry.name.toLowerCase().endsWith(".md")) {
      continue;
    }
    const definition = await parseCommandFile(entryPath, scope, rootDir);
    if (definition) {
      commands.push(definition);
    }
  }

  return commands;
}

async function parseCommandFile(
  filePath: string,
  scope: SlashCommandScope,
  rootDir: string,
): Promise<SlashCommandDefinition | null> {
  const file = Bun.file(filePath);
  if (!(await file.exists())) {
    return null;
  }

  const content = await file.text();
  const { frontmatter, body } = extractFrontmatter(content);

  const relativePath = path.relative(scope === "project" ? workspaceRoot : homedir(), filePath);
  const namespace = determineNamespace(filePath, rootDir);
  const name = path.basename(filePath).replace(/\.[^.]+$/, "");
  const id = namespace ? `${namespace}/${name}` : name;

  const description = frontmatter.description ?? deriveDescription(body);

  return {
    id,
    name,
    namespace,
    scope,
    description,
    argumentHint: frontmatter.argumentHint,
    allowedTools: frontmatter.allowedTools ?? [],
    model: frontmatter.model,
    disableModelInvocation: frontmatter.disableModelInvocation ?? false,
    filePath,
    relativePath,
    body,
  };
}

function determineNamespace(filePath: string, rootDir: string): string | null {
  const relative = path.relative(rootDir, path.dirname(filePath));
  if (!relative || relative === "") {
    return null;
  }
  const normalized = relative.split(path.sep).filter(Boolean).join("/");
  return normalized.length > 0 ? normalized : null;
}

function extractFrontmatter(content: string): { frontmatter: Frontmatter; body: string } {
  if (!content.startsWith("---")) {
    return { frontmatter: {}, body: content };
  }

  const lines = content.split(/\r?\n/);
  const closingIndex = lines.findIndex((line, index) => index > 0 && line.trim() === "---");
  if (closingIndex === -1) {
    return { frontmatter: {}, body: content };
  }

  const fmLines = lines.slice(1, closingIndex);
  const body = lines.slice(closingIndex + 1).join("\n");
  const frontmatter: Frontmatter = {};

  for (const rawLine of fmLines) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) {
      continue;
    }
    const colonIndex = line.indexOf(":");
    if (colonIndex === -1) {
      continue;
    }
    const key = line.slice(0, colonIndex).trim();
    const value = line.slice(colonIndex + 1).trim();

    switch (key) {
      case "description":
        frontmatter.description = stripQuotes(value);
        break;
      case "argument-hint":
        frontmatter.argumentHint = stripQuotes(value);
        break;
      case "allowed-tools":
        frontmatter.allowedTools =
          value.length === 0
            ? []
            : value
                .split(/[,\n]/)
                .map((entry) => stripQuotes(entry.trim()))
                .filter(Boolean);
        break;
      case "model":
        frontmatter.model = stripQuotes(value);
        break;
      case "disable-model-invocation":
        frontmatter.disableModelInvocation = /^true$/i.test(value);
        break;
      default:
        break;
    }
  }

  return { frontmatter, body };
}

function stripQuotes(value: string): string {
  if ((value.startsWith("\"") && value.endsWith("\"")) || (value.startsWith("'") && value.endsWith("'"))) {
    return value.slice(1, -1);
  }
  return value;
}

function deriveDescription(body: string): string | null {
  const lines = body.split(/\r?\n/);
  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed) {
      return trimmed.replace(/^#+\s*/, "");
    }
  }
  return null;
}

function resolveCommand(commands: SlashCommandDefinition[], identifier: string): SlashCommandDefinition | null {
  const exact = commands.find((command) => command.id === identifier);
  if (exact) {
    return exact;
  }

  const matches = commands.filter((command) => command.name === identifier);
  if (matches.length === 1) {
    return matches[0] ?? null;
  }
  if (matches.length > 1) {
    const options = matches.map((command) => `/${command.id}`).join(", ");
    throw new Error(`Multiple commands match /${identifier}. Specify one of: ${options}`);
  }

  return null;
}

function filterUserConflicts(
  projectCommands: SlashCommandDefinition[],
  userCommands: SlashCommandDefinition[],
): SlashCommandDefinition[] {
  if (projectCommands.length === 0) {
    return userCommands;
  }

  const projectNames = new Set(projectCommands.map((command) => command.name));
  return userCommands.filter((command) => !projectNames.has(command.name));
}

function applyArguments(template: string, argumentText: string): string {
  if (!template.includes("$")) {
    return template;
  }

  const positional = parseArguments(argumentText);
  let result = template.replace(/\$ARGUMENTS/g, argumentText);

  result = result.replace(/\$(\d+)/g, (match, index) => {
    const position = Number.parseInt(index, 10) - 1;
    if (Number.isNaN(position) || position < 0) {
      return match;
    }
    return positional[position] ?? "";
  });

  return result;
}

function parseArguments(argumentText: string): string[] {
  const args: string[] = [];
  if (!argumentText) {
    return args;
  }

  const pattern = /"([^"]*)"|'([^']*)'|(\S+)/g;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(argumentText)) !== null) {
    if (match[1] !== undefined) {
      args.push(match[1]);
    } else if (match[2] !== undefined) {
      args.push(match[2]);
    } else if (match[3] !== undefined) {
      args.push(match[3]);
    }
  }
  return args;
}

async function renderEmbeddedCommands(content: string): Promise<string> {
  let result = await replaceInlineCommands(content);
  result = await replaceLineCommands(result);
  return result;
}

async function replaceInlineCommands(content: string): Promise<string> {
  INLINE_COMMAND_PATTERN.lastIndex = 0;
  let match: RegExpExecArray | null;
  let cursor = 0;
  const parts: string[] = [];

  while ((match = INLINE_COMMAND_PATTERN.exec(content)) !== null) {
    const fullMatch = match[0];
    const commandText = match[1];
    if (commandText === undefined) {
      continue;
    }
    const start = match.index;
    const end = start + fullMatch.length;

    parts.push(content.slice(cursor, start));
    const snippet = await formatCommandOutput(commandText.trim());
    parts.push(snippet);
    cursor = end;
  }

  parts.push(content.slice(cursor));
  return parts.join("");
}

async function replaceLineCommands(content: string): Promise<string> {
  const lines = content.split(/\r?\n/);
  let mutated = false;
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    if (line === undefined) {
      continue;
    }
    const match = /^!\s*(.+)$/.exec(line.trim());
    if (!match) {
      continue;
    }
    mutated = true;
    const commandText = match[1];
    if (commandText === undefined) {
      continue;
    }
    lines[index] = await formatCommandOutput(commandText.trim());
  }
  return mutated ? lines.join("\n") : content;
}

async function formatCommandOutput(command: string): Promise<string> {
  if (!command) {
    return "";
  }

  const process = Bun.spawn(["bash", "-lc", command], {
    cwd: workspaceRoot,
    stdout: "pipe",
    stderr: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([
    process.stdout ? new Response(process.stdout).text() : Promise.resolve(""),
    process.stderr ? new Response(process.stderr).text() : Promise.resolve(""),
    process.exited,
  ]);

  const formatted = [
    "```text",
    `command: ${command}`,
    `exit_code: ${exitCode}`,
    stdout ? `stdout:\n${truncate(stdout, MAX_SHELL_OUTPUT)}` : "stdout: <empty>",
    stderr ? `stderr:\n${truncate(stderr, MAX_SHELL_OUTPUT)}` : "stderr: <empty>",
    "```",
  ];
  return `\n${formatted.join("\n")}\n`;
}
