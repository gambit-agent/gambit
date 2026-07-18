# Repository Guidelines

Contributor notes for Gambit CLI—a Bun + TypeScript React CLI. Keep changes consistent, tested, and aligned with the architecture.

## Project Structure & Module Organization

Source lives in `src/` organized by feature:
- `agents/` - Agent definitions and runtime
- `app/` - Bootstrap and shell
- `conversation/` - Conversation state and runner
- `lib/` - Utilities
- `memory/` - Memory persistence
- `permissions/` - Permission system
- `repl/` - Interactive REPL
- `session/` - Session management
- `tasks/` - Background tasks
- `tools/` - Tool implementations
- `types/` - TypeScript definitions
- `ui/` - `@opentui/react` components
- `workboard/` - Workboard UI

Entry points: `src/index.tsx` (dev UI) and `src/gambit.tsx` (CLI binary). Runtime data stored in `.gambit/` (conversations, tasks, memories, skills). Configuration in `tsconfig.json` and `package.json`. Use `.env` for secrets (not committed).

## Build, Test, and Development Commands

- `bun install` — install dependencies
- `bun run src/index.tsx` — start dev UI/CLI
- `bun run src/gambit.tsx` — run standalone CLI
- `bun test` — run all tests; add a path to run a specific file
- `bun run tsc --noEmit` — type-check without building

## Coding Style & Naming Conventions

TypeScript strict mode. Conventions:
- 2-space indent; single quotes; trailing commas on multiline
- `camelCase` for variables/functions; `PascalCase` for components/types; `kebab-case` for files
- Imports: built-ins (`node:`), externals, then local (relative within `src/`)
- Prefer explicit type annotations on public APIs
- Prefer `async/await`; `try/catch` with clear errors
- Functional React components with hooks; use `@opentui/react`

## Testing Guidelines

Bun test runner with co-located `.test.ts` files.
- Use `beforeEach`/`afterEach` for setup/teardown
- Cover unit logic and tool/permission integrations
- Run tests locally before pushing

## Commit & Pull Request Guidelines

Follow Conventional Commits: `<type>(<scope>): <description>`
- Types: `feat`, `fix`, `refactor`, `test`, `chore`, `docs`
- Keep commits small and focused

PRs require:
- Clear description with linked issues (`Fixes #123`)
- Screenshots for UI changes
- Passing tests and type-check

## Security & Configuration Tips

- Never commit secrets; use `.env` (gitignored)
- Tools/agents must declare and honor minimal permissions
- Handle user data and network calls carefully; add tests when changing permission logic

Memory policy:
- Memory lives in `.gambit/memory/` as typed markdown files plus `MEMORY.md` index
- Save only non-derivable context that will matter in future turns
- Use only the relevant memory files for the current request
- Prefer `user`, `feedback`, `project`, or `reference` memory types
