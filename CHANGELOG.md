# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added
- Background task overlay (`Ctrl+B`) redesigned as an "Activity" panel: framed popup, live status counters, `all/running/done/failed` filter tabs, `/` search, ruled group headers with counts, animated running spinners, and inline workflow progress bars.
- Task actions from the overlay: `x` cancels the selected in-flight task, `c` copies its output path, `o` expands the output tail, and `←/→` moves focus between the list and detail panes.
- `mutedFg` theme token for secondary data text in every palette.
- Render tests for the task overlay and unit tests for the new task activity view model.
- Windows PowerShell installer (`install.ps1`) with release download, SHA256 verification, PATH updates, local binary installs, and `gambit update` support.
- Windows release artifacts for `windows-x64`.
- ACP v1 stdio server, available through `gambit acp`, for Zed and other ACP clients.
- ACP session create, list, resume, close, prompt, and cancellation handling backed by Gambit's persisted conversations.
- ACP text, resource, resource-link, and image prompt content with streamed assistant messages and tool-call lifecycle updates.
- ACP client permission requests for permission-gated Gambit tools.
- Native ACP session selectors for model, permission mode, and reasoning effort, including live provider model discovery and persisted model selection.
- ACP slash-command discovery for all built-in commands and project/user commands from `.gambit/commands`, plus local handling for `/model`, `/help`, context reset, and headless-compatible commands.
- Zed custom-agent setup and ACP capability/limitation documentation in `docs/acp.md`.

### Changed
- Task rows in the overlay use laid-out columns (status glyph, kind, title, right-aligned elapsed) instead of a single padded string, and transcript entries render with a coloured glyph gutter rather than `tool start …` prose prefixes.
- `selectedBg` in the Gambit Dark palette lightened from `#1a1a1a` to `#241E22` so selection is visible against the `#131313` background.
- The active/recent task split is shared between the footer panel and the overlay so their row order cannot drift.
- Shared Gambit's model catalog loading between the interactive picker and ACP sessions.
- Runtime bootstrap and tool execution now accept ACP-scoped workspace, cancellation, permission, and disabled-tool configuration.
- **Breaking:** project plugins in `.gambit/plugins` and `.opencode/plugins` no longer load automatically. Add the workspace root to `trustedProjectPluginRoots` in `~/.gambit/config.json`, or set `GAMBIT_TRUST_PROJECT_PLUGINS=1`. User-level plugins in `~/.gambit/plugins` are unaffected.
- Shell output collection now stops shortly after the command exits instead of waiting for every stdio pipe to close. A backgrounded grandchild holding a pipe open no longer blocks the turn on any platform; in exchange, output written more than 250ms after the command exits is not captured.
- `grep` and `glob` normalize ripgrep's output to POSIX separators, so results no longer differ by platform or by which search backend answered.
- `grep` and `glob` append `[ripgrep unavailable; used builtin search]` when they fall back, so degraded search is visible rather than silent.
- MCP server credentials in `mcp-servers.json` are now written `0600`.

### Fixed
- ACP cancellation now aborts active model turns and reports the protocol `cancelled` stop reason.
- `call-mcp-tool` and `toggle-mcp-server` now request permission. Both previously executed without approval because the execution pipeline skips evaluation for tools that define no permission request.
- Oversized tool results can no longer be written outside `.gambit/tool-results` via a provider-supplied tool call id containing path separators.
- Opening or resuming an ACP session no longer marks other sessions' running tasks as cancelled. Interrupted-task reconciliation runs once per process rather than once per session runtime.
- Cancelling a workflow now aborts the running script and its subagents instead of only recording `cancelled` and later overwriting it with `completed`.
- Cancelling or timing out a foreground shell command no longer hangs the turn on Windows.
- Multi-file patches apply atomically: a hunk that fails to apply leaves every file untouched instead of writing the files before it.
- Patch failures name the file that could not be applied.
- `grep` and `glob` fall back to the builtin search when ripgrep fails to start, instead of surfacing `rg exited with code 2` as a tool error.
- Plan files remain reachable after a restart; the session-to-plan mapping is persisted rather than held only in memory.
- A turn that recalls no memory no longer leaves the previous turn's memory context in the prompt.
- ACP model and slash-command capabilities are published after new and resumed session setup so clients such as Zed can render their native selectors and command menus.

## [0.7.0] — 2026-05-30

### Added
- Productionized repository for open-source distribution: added `Makefile`, `CONTRIBUTING.md`, `CHANGELOG.md`, and build scripts.
- JSDoc comments and module-level documentation across core source files.
- `make install` and `make compile` targets for compiling and installing a native binary locally.
- `bun link` / `make link-local` workflow for global development installs.
- Extensionless `install` script for `curl .../install | bash` installs, with version pinning, local binary installs, checksum verification, custom install directories, and optional PATH updates.

### Changed
- Reworked installation docs around GitHub Release binaries and source checkout workflows.
- Replaced stale `setup.*` scripts with Bun-based source checkout bootstrap scripts.
- Added React type declarations to make strict TypeScript checks pass in clean CI installs.

### Removed
- Removed leftover Claude Code / local alias behavior from Windows and setup scripts.

## [0.6.0] — 2025-05-17

### Added
- Real-time reasoning display in the REPL before tool calls when `showReasoning` is enabled.
- `patchFile` robustness fixes: empty-base file creation, trailing-whitespace tolerance, improved error messages.
- `flushReasoning()` in `AgentRunner` so thinking traces appear in background tasks.
- Stream-logger integration across `AgentRunner` and `ConversationRunner` for richer telemetry.

### Changed
- Tool call log format in REPL changed from `"Tool · toolName · status · summary"` to `"Tool: toolName [status] summary"` for better readability.

### Fixed
- Hunk header regex in `src/lib/diff.ts` now correctly parses `@@ -1 +1 @@` (the comma is required for optional line counts).
- `normalizeLines()` handles empty source text without producing phantom newlines.

## [0.5.0] — 2025-05-10

### Added
- Agent Skills with progressive disclosure (`activateSkill` tool, skill catalog budget, `SKILL.md` frontmatter support).
- MCP client support: `stdio` and `streamable-http` transports, server management overlays, and tool/resource discovery.
- Headless mode with `--prompt`, `--output-format`, and `--events` flags for CI/scripting usage.
- Plan mode (`EnterPlanMode` / `ExitPlanMode` tools) with user approval workflow.
- Permission engine with Normal, Plan, Auto-accept, and acceptEdits modes.
- Background tasks panel (`Ctrl+B`) with live progress summaries.
- Conversation compaction based on model-specific context windows.
- `install.sh` remote installer with platform detection, musl/Rosetta support, and SHA256 verification.

### Changed
- Default model switched to `codex/gpt-5.1-codex`.
- Improved permission dialog UX with explanation toggle (`Ctrl+E`).

## [0.4.0] — 2025-04-28

### Added
- Conversation forking (`:fork`) and tree visualization (`:tree`).
- Slash command system with user and project scopes.
- Plugin hooks (`tool.execute.before`, `command.execute.before`, etc.) loaded from `.gambit/plugins/` and `.opencode/plugins/`.
- Memory persistence (`writeMemory`, `MemoryStore`) with typed markdown records.
- Task runtime with shell and agent delegation (`spawnAgent`).

## [0.3.0] — 2025-04-15

### Added
- Model picker overlay with reasoning-effort selection.
- Session picker (`:resume`) with filtering and latest-conversation continuation (`-c`).
- Keyboard shortcuts: scroll, vim navigation, transcript mode, prompt stashing.
- OpenRouter provider integration via Vercel AI SDK.

## [0.2.0] — 2025-04-01

### Added
- Built-in tools: `readFile`, `writeFile`, `patchFile`, `executeShell`, `askUserQuestion`.
- Interactive REPL with message history and tool call rendering.
- `.gambit/` runtime directory for conversations, tasks, and memory.

## [0.1.0] — 2025-03-20

### Added
- Initial project scaffold with Bun, TypeScript, React, and OpenTUI.
- Basic conversation loop with `streamText` from `ai` SDK.
- Simple permission prompt and file I/O tools.
