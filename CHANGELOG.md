# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added
- Productionized repository for open-source distribution: added `Makefile`, `CONTRIBUTING.md`, `CHANGELOG.md`, and build scripts.
- JSDoc comments and module-level documentation across core source files.
- `make install` and `make compile` targets for compiling and installing a native binary locally.
- `bun link` / `make link-local` workflow for global development installs.
- Extensionless `install` script for `curl .../install | bash` installs, with version pinning, local binary installs, checksum verification, custom install directories, and optional PATH updates.

### Changed
- Reworked installation docs around GitHub Release binaries and source checkout workflows.
- Replaced stale `setup.*` scripts with Bun-based source checkout bootstrap scripts.

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
