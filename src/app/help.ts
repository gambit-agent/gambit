import { appVersion } from './version'

const HELP_TEXT = `gambit ${appVersion} — TUI coding agent

USAGE
  gambit [options]                          Launch the interactive TUI
  gambit -p <prompt> [options]              Run a single prompt headlessly
  gambit install [options]                  Install the gambit CLI
  gambit update [latest|VERSION]            Update the installed CLI from GitHub Releases
  gambit --help | -h                        Show this help
  gambit --version | -V                     Print the version

SESSION
  -c, --continue                            Continue the most recent conversation
  -r, --resume [id|query]                   Resume by conversation id, or open the session picker
                                              (optional query pre-filters the list)

HEADLESS
  -p, --prompt, --print <text>              Run a single turn non-interactively and print the result
  --output-format <text|json|stream-json>   Output format for headless mode (default: text)
  --events                                  Shortcut for --output-format stream-json
  --verbose                                 Include intermediate events in headless output
  --include-partial-messages                Emit in-progress deltas when streaming JSON events
  --allowed-tools <a,b,c>                   Comma-separated tool ids permitted during the run
  --system-prompt <text>                    Replace the default system prompt
  --append-system-prompt <text>             Append text to the system prompt (repeatable)
  --append-system-prompt-file <path>        Append the contents of a file (repeatable)
  --permission-mode <mode>                  One of: Normal, Plan, Auto-accept, acceptEdits
  --mcp-config <path>                       Path to an MCP server config JSON

ENVIRONMENT
  OPENROUTER_API_KEY                        API key override; otherwise ~/.gambit/config.json is used
  GAMBIT_MODEL                              Optional default model id
  OPENROUTER_MODEL                          Back-compat default model id override
  OPENAI_CODEX_ACCESS_TOKEN                 Optional Codex subscription access token
  CODEX_AUTH_FILE                           Optional path to Codex auth.json (default ~/.codex/auth.json)
  OPENROUTER_REFERRER                       HTTP-Referer header sent to OpenRouter
  OPENROUTER_TITLE                          X-Title header sent to OpenRouter
  WORKSPACE_ROOT                            Override the workspace root directory
`

export function printHelp(): void {
  process.stdout.write(HELP_TEXT)
}
