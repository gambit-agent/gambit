# Gambit CLI

> Interactive AI agent development environment built with Bun, TypeScript, and OpenTUI.

<img width="1727" height="1360" alt="Screenshot" src="https://github.com/user-attachments/assets/c2738f9a-d1e7-48e6-b242-0d762c6e6da4" />

[![Bun](https://img.shields.io/badge/Bun-1.2+-f9f1e1?logo=bun&logoColor=f9f1e1&labelColor=14151a)](https://bun.sh)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.9+-3178c6?logo=typescript&logoColor=white&labelColor=14151a)](https://www.typescriptlang.org/)
[![OpenTUI](https://img.shields.io/badge/OpenTUI-0.3.0-6c5ce7?labelColor=14151a)](https://github.com/opentui/opentui)
[![License](https://img.shields.io/github/license/gambit-agent/gambit?labelColor=14151a)](LICENSE)
[![Release](https://img.shields.io/github/v/release/gambit-agent/gambit?labelColor=14151a)](https://github.com/gambit-agent/gambit/releases/latest)

## Overview

Gambit CLI is a terminal-based UI for creating, managing, and interacting with AI agents. It runs on [OpenTUI](https://github.com/opentui/opentui), uses the [Vercel AI SDK](https://sdk.vercel.ai/) with OpenRouter, and ships a growing set of built-in tools plus MCP (Model Context Protocol) support for connecting external tool servers.

Features:

- Interactive REPL with persistent conversations, background tasks, typed memory, and permission-gated tools.
- Comprehensive keyboard shortcuts — transcript mode, scroll navigation, vim-style keys, double-press exit confirmation, and prompt stashing.
- Plan mode with `EnterPlanMode` / `ExitPlanMode` tools for structured agent workflows.
- Headless mode (`-p` / `--prompt`) for scripting and CI usage, with JSON and streaming output formats.
- MCP client with `stdio` and `streamable-http` transports.
- Pluggable slash commands loaded from user and project scopes.
- Agent Skills with progressive disclosure — the model sees a compact catalog up front and loads full instructions only when activating a skill.
- Plugin hooks for project/user extensibility, including OpenCode-compatible `.opencode/plugins` discovery.

## Install

### Quick install

Windows PowerShell:

```powershell
irm https://raw.githubusercontent.com/gambit-agent/gambit/main/install.ps1 | iex
```

Linux, macOS, and WSL:

```bash
curl -fsSL https://raw.githubusercontent.com/gambit-agent/gambit/main/install | bash
```

The installer detects your platform (including Windows, WSL, musl Linux, and Rosetta on macOS), downloads the matching prebuilt binary from GitHub Releases, verifies its SHA256 against the release `manifest.json`, installs it to the user-local bin directory, and updates PATH when possible.

Install a specific version, choose a directory, or install a local binary:

```bash
# Bash: latest stable release
curl -fsSL https://raw.githubusercontent.com/gambit-agent/gambit/main/install | bash

# Bash: specific version
curl -fsSL https://raw.githubusercontent.com/gambit-agent/gambit/main/install | bash -s -- --version 0.7.0

# Bash: custom install directory
curl -fsSL https://raw.githubusercontent.com/gambit-agent/gambit/main/install | bash -s -- --install-dir "$HOME/bin"

# Bash: local compiled binary
./install --binary ./gambit
```

```powershell
# PowerShell: specific version
& ([scriptblock]::Create((irm https://raw.githubusercontent.com/gambit-agent/gambit/main/install.ps1))) -Version 0.7.0

# PowerShell: custom install directory
& ([scriptblock]::Create((irm https://raw.githubusercontent.com/gambit-agent/gambit/main/install.ps1))) -InstallDir "$HOME\bin"

# PowerShell: local compiled binary
.\install.ps1 -Binary .\gambit.exe
```

After installing, update to the latest release with:

```bash
gambit update
```

To update to a specific version, run `gambit update 0.7.0`. On Windows, `gambit update` uses the PowerShell installer and waits for the running `gambit.exe` to exit before replacing it.

Supported platforms: `linux-x64`, `linux-x64-musl`, `linux-arm64`, `linux-arm64-musl`, `darwin-x64`, `darwin-arm64`, `windows-x64`, `windows-arm64`.

Environment overrides:

- `GAMBIT_REPO` — `owner/repo` to download from (default: `gambit-agent/gambit`).
- `GAMBIT_BIN_DIR` — install location for the launcher (default: `~/.local/bin` on Unix and `$HOME\.local\bin` on Windows).
- `VERSION` — version to install when `--version` is not passed.

### Manual install

Grab a binary from the [latest release](https://github.com/gambit-agent/gambit/releases/latest), verify its SHA256 against `manifest.json`, then install it with `./install --binary ./gambit-<platform>` or `.\install.ps1 -Binary .\gambit-<platform>.exe` on Windows.

### Install from source

Requires [Bun](https://bun.sh) 1.2.20+.

```bash
git clone https://github.com/gambit-agent/gambit.git
cd gambit
bun install
make install        # compile a native binary and copy to ~/.local/bin
```

Or symlink for active development:

```bash
bun install
make link-local     # or: bun link
```

After linking, `gambit` is available globally and will run from source.

You can also run directly without installing:

```bash
bun run src/gambit.tsx      # production parity entry
bun run src/index.tsx       # dev UI with hot-reload
```

## Usage

### Interactive

```bash
gambit                       # new conversation
gambit -c                    # continue the last conversation
gambit -r                    # pick a conversation to resume
gambit -r <conversation-id>  # resume a specific conversation
```

Inside the REPL, colon commands drive the shell itself:

- `:model` — switch the active model
- `:key` — set or update the OpenRouter API key
- `:mcp` — manage MCP servers
- `:resume` — open the resume picker
- `:goal <goal>` — set and run a Codex-style autonomous conversation goal
- `:reset` — clear the current session state

Slash commands (`/name [args]`) are loaded from markdown files in `~/.gambit/commands/` (user scope) and `./.gambit/commands/` (project scope). They support frontmatter for `description`, `allowed-tools`, `model`, and `disable-model-invocation`. Built-ins include `/model`, `/resume`, `/clear`, and `/goal <goal>`; `/goal <goal>` starts a Codex-style autonomous run immediately, `/goal set <goal>` stores without running, `/goal run` resumes the stored goal, and `/goal clear` removes it.

Agent Skills are loaded from `SKILL.md` files under `~/.gambit/skills/` and `./.gambit/skills/` (and the cross-client `.agents/skills/` convention at both scopes). See [Agent Skills](#agent-skills) below.

Plugins are loaded from `./.gambit/plugins/`, `./.opencode/plugins/`, and `~/.gambit/plugins/`. A plugin exports a function returning hooks such as `tool.execute.before`, `tool.execute.after`, `command.execute.before`, `command.execute.after`, and `event`.

### Keyboard shortcuts

| Shortcut | Context | Action |
|---|---|---|
| `Ctrl+C` | Global | Abort current run (press twice within 800ms to exit) |
| `Ctrl+D` | Global | Exit (press twice within 800ms to confirm) |
| `Ctrl+L` | Global | Clear / redraw screen |
| `Ctrl+O` | Global | Toggle transcript mode (expand tool call details) |
| `Ctrl+R` | Global | Reverse history search |
| `Ctrl+B` | Chat | Background current task / toggle task panel |
| `Ctrl+S` | Chat | Stash prompt (save current input; press again to restore) |
| `Tab` | Chat | Toggle thinking / extended reasoning |
| `Shift+Tab` | Chat / Permission | Cycle permission mode (Normal → plan → Auto-accept) |
| `Page Up / Down` | Global | Scroll conversation by one page |
| `Ctrl+Home / End` | Global | Jump to top / bottom of conversation |
| `Up / Down` | Chat | Navigate command history |
| `Ctrl+Enter` | Chat | Insert newline (also `Alt+Enter`, `Shift+Enter`, `Ctrl+J`) |
| `Y` / `Enter` | Permission | Allow |
| `N` / `Escape` | Permission | Deny |
| `Ctrl+E` | Permission | Toggle explanation details |
| `j` / `k` | Pickers | Navigate down / up (vim-style) |
| `Ctrl+N` / `Ctrl+P` | Pickers | Navigate down / up |
| `q` / `Escape` | Transcript | Exit transcript mode |
| `Esc Esc` | Chat | Rewind to previous snapshot (double-press within 400ms) |

### Headless

Provide `-p` / `--prompt` to run non-interactively:

```bash
gambit -p "Summarize the README"                             # text output
gambit -p "Refactor this file" --output-format stream-json   # streaming JSON events
gambit -p "List the open TODOs" --permission-mode Auto-accept
```

Flags:

| Flag | Description |
|---|---|
| `-p` / `--prompt` / `--print` | Prompt string (enables headless mode). |
| `--output-format` | `text` (default), `json`, or `stream-json`. |
| `--events` | Shortcut for `--output-format stream-json`. |
| `--verbose` | Include intermediate events in headless output. |
| `--include-partial-messages` | Emit in-progress deltas when streaming JSON events. |
| `--allowed-tools` | Comma-separated allowlist of tool IDs. |
| `--system-prompt` | Replace the system prompt. |
| `--append-system-prompt` | Append to the system prompt (repeatable). |
| `--append-system-prompt-file` | Append the contents of a file (repeatable). |
| `--permission-mode` | `Normal`, `plan`, `Auto-accept`, `acceptEdits`. |
| `--mcp-config` | Path to an MCP config file. |
| `-c` / `--continue` | Continue the last conversation. |
| `-r` / `--resume [id]` | Resume a conversation by id, or open the picker. |

## Built-in tools

Default registered tools (see `src/tools/builtins.ts`):

- `readFile`, `searchFiles`, `writeFile`, `patchFile` — workspace file I/O and read-only search.
- `executeShell` — run shell commands via `bash -lc`, with optional per-call timeout.
- `slashCommand` — invoke a registered slash command.
- `activateSkill` — load an Agent Skill's full instructions on demand. Only registered when at least one skill is installed.
- `listTasks`, `getTaskStatus`, `readTaskOutput`, `cancelTask` — inspect and control background shell/agent tasks.
- `writeMemory` — persist typed memory records (`user`, `feedback`, `project`, `reference`).
- `spawnAgent` — delegate to a local subagent (`default`, `explorer`, or `worker`).
- `EnterPlanMode` / `ExitPlanMode` — structured plan-then-execute workflow. The agent explores the codebase, writes a plan, gets user approval, then implements.
- MCP management: `list-mcp-resources`, `read-mcp-resource`, `list-mcp-tools`, `call-mcp-tool`, `list-mcp-servers`, `add-mcp-server`, `remove-mcp-server`, `toggle-mcp-server`.

## MCP support

Gambit is an MCP client with two transports:

- `stdio` — spawn a local process.
- `streamable-http` — connect to a remote HTTP server, with optional `bearerToken`, `apiKey`, or custom headers.

Server config lives at `~/.gambit/mcp-servers.json`, or pass `--mcp-config <path>` in headless mode. Manage servers with the `:mcp` colon command or the `add-mcp-server` / `remove-mcp-server` tools.

## Agent Skills

Agent Skills follow the [agentskills.io](https://agentskills.io) specification: each skill is a directory containing a `SKILL.md` file with YAML frontmatter (`name`, `description`) plus any supporting `scripts/`, `references/`, or `assets/`. Gambit uses progressive disclosure to keep the context window small:

1. **Catalog (~100 tokens per skill)** — discovered skills are listed as `name — description` in the description of the `activateSkill` tool. The model sees the list up front.
2. **Instructions** — calling `activateSkill({ name })` returns the full `SKILL.md` body wrapped in `<skill_content>` tags, plus the skill's directory path and a `<skill_resources>` listing of bundled files.
3. **Resources** — files inside the skill directory (scripts, references, assets) are loaded on demand via the existing `readFile` tool.

### Discovery locations

Skills are discovered, in precedence order, from:

- `./.gambit/skills/` — project scope, Gambit-native.
- `./.agents/skills/` — project scope, cross-client convention.
- `~/.gambit/skills/` — user scope, Gambit-native.
- `~/.agents/skills/` — user scope, cross-client convention.

Project-scope skills shadow user-scope skills with the same `name`.

### `SKILL.md` format

```markdown
---
name: pdf-processing
description: Extract PDF text, fill forms, merge files. Use when handling PDFs.
license: Apache-2.0
---

# PDF Processing

Use pdfplumber for text extraction. For scanned documents, fall back to pdf2image + pytesseract.

See `references/pdf-spec-summary.md` and `scripts/extract.py`.
```

Supported frontmatter fields: `name` (required, must match the directory), `description` (required, ≤1024 chars), `license`, `compatibility`, `allowed-tools`. Skills missing a description are skipped and a warning is logged.

### Configuration

- `SKILL_CATALOG_CHAR_BUDGET` — truncation budget for the catalog embedded in the tool description (default `8000`). Long catalogs are summarized with a `… (N more skills)` note.
- `GAMBIT_MAX_AGENT_STEPS` — maximum model/tool loop steps per main or delegated agent turn (default `200`).

When no skills are installed, the `activateSkill` tool is **not** registered, so there's zero overhead for users who don't use skills.

## Runtime data

Gambit writes runtime state under `.gambit/` in your home directory and/or the current workspace:

- `conversations/` — conversation transcripts.
- `tasks/` — background task records and output logs.
- `memory/` — typed memory markdown files (`user`, `feedback`, `project`, `reference`).
- `commands/` — user/project slash command definitions.
- `skills/` — user/project Agent Skill directories (each contains a `SKILL.md`).
- `mcp-servers.json` — MCP server config.
- `model-selection.json` — active model.
- `downloads/` — cache used by the installer.

None of this is committed — keep it gitignored.

## Development

```bash
bun install                       # install dependencies
make build                         # type-check + test
make compile                       # build native binary
make install                       # compile + install to ~/.local/bin
make link-local                    # symlink for global dev use
bun run src/gambit.tsx             # run CLI from source
bun run src/index.tsx              # dev UI entry with hot-reload
bun test                           # run the test suite
bun run tsc --noEmit               # type-check
```

### Project layout

```
src/
├── agents/         # Agent definitions and runtime logic
├── app/            # Launch options, bootstrap, headless runner, install
├── conversation/   # Conversation state machine and runner
├── lib/            # Shared utilities (diff, slash commands, shortcuts, MCP config, ...)
├── memory/         # Typed memory persistence
├── permissions/    # Permission engine and prompts
├── plans/          # Plan mode storage and utilities
├── questions/      # AskUserQuestion engine
├── repl/           # Interactive REPL and input routing
├── session/        # Session transcripts and model selection
├── tasks/          # Background task runtime (shell + agent)
├── tools/          # Built-in tools, registry, MCP client bridge
├── types/          # Shared TypeScript types
├── ui/             # @opentui/react components (panels, overlays, pickers)
├── workboard/      # Workboard UI
├── index.tsx       # Dev UI entry (hot-reload)
└── gambit.tsx      # CLI entry (binary target)
```

### Cutting a release

Release binaries are built by `.github/workflows/release.yml` when a `v*` tag is pushed:

```bash
git tag v0.4.0
git push origin v0.4.0
```

The workflow cross-compiles for all supported platforms using `bun build --compile`, produces a `manifest.json` of SHA256 checksums, and publishes them as release assets. After the release lands, `install` will resolve `stable` / `latest` to that tag.

## Security

- Never commit secrets. Use a `.env` file (gitignored) for environment variables.
- Tools and agents declare the minimal permissions they require; user approval is requested at runtime.
- Runtime state under `.gambit/` is not committed.

## Contributing

Gambit follows Conventional Commits. All PRs must pass `bun test` and `bun run tsc --noEmit`. See [CONTRIBUTING.md](CONTRIBUTING.md) and [AGENTS.md](AGENTS.md) for detailed contributor guidelines.
