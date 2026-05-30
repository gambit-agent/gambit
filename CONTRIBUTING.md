# Contributing to Gambit

Thank you for considering a contribution! Gambit is a Bun + TypeScript TUI for AI agents. This guide will help you get started.

## Prerequisites

- [Bun](https://bun.sh) **>= 1.2.20**
- Git

## Setup

```bash
git clone https://github.com/gambit-agent/gambit.git
cd gambit
bun install
```

Verify everything works:

```bash
make build
```

If you only need a type-check while iterating:

```bash
make typecheck
```

## Development workflow

### Running from source

```bash
# Interactive TUI (dev entry with hot-reload)
bun run src/index.tsx

# CLI binary entry (production parity)
bun run src/gambit.tsx
```

### Installing locally

For day-to-day local use without releasing:

```bash
# Option A: compile a native binary and install it
make install

# Option B: symlink the source project globally
make link-local   # or: bun link
```

To test the public installer against a local binary:

```bash
make compile
./install --binary ./gambit --no-modify-path
```

### Testing

All changes must pass the test suite and TypeScript type-check:

```bash
bun test
bun run tsc --noEmit
```

Run a specific test file:

```bash
bun test src/lib/diff.test.ts
```

## Commit conventions

We follow [Conventional Commits](https://www.conventionalcommits.org/):

```
<type>(<scope>): <description>
```

Common types: `feat`, `fix`, `refactor`, `test`, `chore`, `docs`.

Examples:

- `feat(repl): add vim-style navigation to pickers`
- `fix(tools): handle empty source text in patchFile`
- `docs(readme): update MCP configuration examples`

## Pull request checklist

Before opening a PR, please ensure:

- [ ] `make build` passes (type-check + tests).
- [ ] New logic is covered by tests when possible.
- [ ] Public APIs have explicit types and comments where they clarify non-obvious behavior.
- [ ] `README.md` or other docs are updated if user-facing behavior changed.
- [ ] Installer, release, or packaging changes are reflected in `INSTALL.md` and `CHANGELOG.md`.
- [ ] Commit messages follow Conventional Commits.

## Project structure

See `AGENTS.md` for a detailed architecture guide. Key directories:

- `src/agents/` — Agent definitions and runtime
- `src/app/` — Bootstrap, launch options, shell providers
- `src/conversation/` — Conversation state machine and runner
- `src/lib/` — Shared utilities (diff, model picker, MCP config, …)
- `src/permissions/` — Permission engine and prompts
- `src/repl/` — Interactive REPL screen
- `src/tasks/` — Background task runtime
- `src/tools/` — Built-in tools, registry, MCP client bridge
- `src/ui/` — OpenTUI React components
- `src/workboard/` — Workboard UI

## Security

- Never commit secrets or API keys.
- Use `.env` (gitignored) for local environment variables.
- Tools and agents must request the minimal permissions they require.

## Getting help

Open a [discussion](https://github.com/gambit-agent/gambit/discussions) or [issue](https://github.com/gambit-agent/gambit/issues) if you have questions.

For installer behavior and supported release targets, see [INSTALL.md](INSTALL.md).
