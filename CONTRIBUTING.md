# Contributing to Gambit

Thank you for considering a contribution! Gambit is a Bun + TypeScript TUI for AI agents. This guide will help you get started.

## Prerequisites

- [Bun](https://bun.sh) **>= 1.2.20**
- Git

## Setup

```bash
git clone https://github.com/sergiomasellis/gambit-cli.git
cd gambit-cli
bun install
```

Verify everything works:

```bash
make build
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
- [ ] JSDoc comments are added for new public APIs.
- [ ] `README.md` or other docs are updated if user-facing behavior changed.
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

Open a [discussion](https://github.com/sergiomasellis/gambit-cli/discussions) or [issue](https://github.com/sergiomasellis/gambit-cli/issues) if you have questions.
