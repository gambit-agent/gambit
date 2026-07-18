// Bun embeds the canonical system prompt as a string at build time (the text
// loader also works with `bun build --compile`), so the full prompt ships with
// the compiled binary instead of depending on the repository checkout.
import canonicalSystemPrompt from "../../system.prompt.md" with { type: "text" };

import { parseFrontmatter } from "./frontmatter";
import { PROJECT_DOC_SEPARATOR, readProjectDocs } from "./projectDocs";
import { resolveWorkspacePath } from "./workspace";

export const builtinSystemPrompt = canonicalSystemPrompt.trim();

export const WORKSPACE_PROMPT_SECTION_HEADER =
  "## Workspace system prompt additions (from system.prompt.md)";

export type WorkspacePromptMode = "replace" | "append";

export interface LoadSystemPromptOptions {
  /** Receives a notice line when a workspace system.prompt.md override is applied. */
  notify?: (message: string) => void;
}

export interface LoadedSystemPrompt {
  prompt: string;
  /**
   * Which workspace system.prompt.md mode contributed to the prompt, or null
   * when no workspace override was applied. Callers/UI can surface this so an
   * active override is discoverable (the console notice is invisible once the
   * alternate screen takes over).
   */
  workspaceOverride: WorkspacePromptMode | null;
}

export async function loadSystemPrompt(options: LoadSystemPromptOptions = {}): Promise<string> {
  const { prompt } = await loadSystemPromptDetailed(options);
  return prompt;
}

export async function loadSystemPromptDetailed(
  options: LoadSystemPromptOptions = {},
): Promise<LoadedSystemPrompt> {
  const notify = options.notify ?? ((message: string) => console.error(message));
  let prompt = builtinSystemPrompt;
  let workspaceOverride: WorkspacePromptMode | null = null;

  try {
    const promptPath = resolveWorkspacePath("system.prompt.md");
    const promptFile = Bun.file(promptPath);
    if (await promptFile.exists()) {
      const raw = (await promptFile.text()).trim();
      const { mode, content } = parseWorkspacePrompt(raw);

      if (content.length > 0) {
        if (mode === "replace") {
          // Explicit opt-in via `mode: replace` frontmatter: the workspace
          // prompt fully replaces the built-in one.
          prompt = content;
          workspaceOverride = "replace";
          notify(`gambit: replacing the built-in system prompt with ${promptPath}`);
        } else if (!isLikelyBuiltinPromptCopy(content)) {
          // Default: append workspace instructions to the built-in prompt.
          // Skip when the workspace file looks like a copy of the canonical
          // prompt itself (e.g. running gambit inside its own repository).
          prompt = [
            prompt,
            WORKSPACE_PROMPT_SECTION_HEADER,
            "The workspace provides the following additional system prompt instructions. They supplement the built-in instructions above.",
            content,
          ].join("\n\n");
          workspaceOverride = "append";
          notify(`gambit: appending workspace system prompt overrides from ${promptPath}`);
        }
      }
    }
  } catch {
    // Ignore and use the built-in prompt
  }

  try {
    const projectDocs = await readProjectDocs();
    if (projectDocs) {
      prompt = prompt ? `${prompt}${PROJECT_DOC_SEPARATOR}${projectDocs}` : projectDocs;
    }
  } catch (error) {
    console.error("Failed to load project docs:", error);
  }

  return { prompt, workspaceOverride };
}

/**
 * Parse the workspace system.prompt.md. An optional YAML frontmatter block may
 * select the merge mode via `mode: replace` or `mode: append`; anything else
 * (including no frontmatter) defaults to append. The frontmatter block is
 * stripped from the prompt content either way.
 */
function parseWorkspacePrompt(raw: string): { mode: WorkspacePromptMode; content: string } {
  const { values, body, hasFrontmatter } = parseFrontmatter(raw, { trimBodyStart: true });
  const mode = values.mode?.trim().toLowerCase() === "replace" ? "replace" : "append";
  return {
    mode,
    content: (hasFrontmatter ? body : raw).trim(),
  };
}

/**
 * Heuristic guard against appending a stale copy of the canonical prompt to
 * itself (version skew: a workspace checkout of system.prompt.md from a
 * slightly older or newer gambit than the running binary). Exact equality is
 * too brittle for that case, so the workspace file is treated as a copy of the
 * built-in prompt when its first non-empty line is identical AND its length is
 * within 10% of the built-in prompt's length.
 */
function isLikelyBuiltinPromptCopy(content: string): boolean {
  if (content === builtinSystemPrompt) {
    return true;
  }
  const contentFirstLine = firstNonEmptyLine(content);
  const builtinFirstLine = firstNonEmptyLine(builtinSystemPrompt);
  if (!contentFirstLine || contentFirstLine !== builtinFirstLine) {
    return false;
  }
  return Math.abs(content.length - builtinSystemPrompt.length) <= builtinSystemPrompt.length * 0.1;
}

function firstNonEmptyLine(text: string): string | null {
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (trimmed) {
      return trimmed;
    }
  }
  return null;
}
