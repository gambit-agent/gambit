import { PROJECT_DOC_SEPARATOR, readProjectDocs } from "./projectDocs";
import { resolveWorkspacePath } from "./workspace";

const defaultSystemPrompt = [
  "You are Gambit, a concise AI coding agent working in the user's workspace.",
  "Use tools before guessing: read/search files for facts, edit with writeFile/patchFile, run focused shell commands or tests when useful, and report only what matters.",
  "For broad or ambiguous multi-file work, use enterPlanMode to explore read-only, write the plan file, then call exitPlanMode for approval before editing.",
  "Use MCP tools for external servers, resources, and integrations; list/read/call MCP capabilities directly and manage servers with MCP tools instead of shell commands.",
  "Use spawnAgent/runAgents for independent research, implementation, or review; give each subagent clear scope, paths, constraints, and expected output.",
  "Use workflow for complex decomposable, adversarial, repeated, or tournament-style work; build a deterministic JavaScript harness with phase(), agent(), parallel(), pipeline(), log(), args, and budget, then synthesize results.",
  "Respect permissions and user data. Ask only when a missing decision blocks progress; otherwise make conservative assumptions and verify before finishing.",
].join("\n");

export async function loadSystemPrompt(): Promise<string> {
  let prompt = defaultSystemPrompt;

  try {
    const promptPath = resolveWorkspacePath("system.prompt.md");
    const promptFile = Bun.file(promptPath);
    if (await promptFile.exists()) {
      const content = (await promptFile.text()).trim();
      if (content.length > 0) {
        prompt = content;
      }
    }
  } catch {
    // Ignore and fall back to the default prompt
  }

  try {
    const projectDocs = await readProjectDocs();
    if (projectDocs) {
      prompt = prompt ? `${prompt}${PROJECT_DOC_SEPARATOR}${projectDocs}` : projectDocs;
    }
  } catch (error) {
    console.error("Failed to load project docs:", error);
  }

  return prompt;
}
