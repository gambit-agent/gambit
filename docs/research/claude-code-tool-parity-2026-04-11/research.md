# Claude Code Tool Parity — Gap Analysis

**Date:** 2026-04-11
**Scope:** Compare gambit's tool surface against the Claude Code reference tool set (captured in the user-provided `claude-opus-4-5-20251101` tool manifest) and identify missing tools + description/schema alignment opportunities.

> **Update (2026-04-11):** Agent Skills landed after the initial gap analysis — gambit now ships an `activateSkill` tool with progressive disclosure that matches Claude Code's `Skill` semantics. The entries below have been updated to reflect that; `Skill` is no longer a gap.

---

## 1. Reference sets

### Claude Code tools (reference)
`Task`, `TaskOutput`, `Bash`, `Glob`, `Grep`, `ExitPlanMode`, `Read`, `Edit`, `Write`, `NotebookEdit`, `WebFetch`, `TodoWrite`, `WebSearch`, `KillShell`, `AskUserQuestion`, `Skill`, `EnterPlanMode`.

### Gambit built-in tools (current)
From `src/tools/builtins.ts` and `src/tools/mcp.ts`:

- `readFile`
- `writeFile`
- `patchFile`
- `executeShell`
- `slashCommand`
- `activateSkill` (conditionally registered when at least one `SKILL.md` is discovered under `.gambit/skills/` or `.agents/skills/`; see `src/lib/skills.ts`)
- `readTaskOutput`
- `writeMemory`
- `spawnAgent` (optional; `includeSpawnAgent: false` in default registry at `src/tools/index.ts:59`)
- MCP management tools: `list-mcp-resources`, `read-mcp-resource`, `list-mcp-tools`, `call-mcp-tool`, `list-mcp-servers`, `add-mcp-server`, `remove-mcp-server`

---

## 2. Alignment status of existing tools

| Gambit tool | Closest Claude Code tool | Alignment | Notes |
|---|---|---|---|
| `readFile` | `Read` | ⚠️ Weak | Schema is only `{ path }`. Missing `offset` / `limit`, absolute-path support, images, PDFs, notebooks. Description is one line; Claude Code's is a detailed usage guide. |
| `writeFile` | `Write` | ⚠️ Weak | Description is one line. Missing "must Read first" guardrail text and "prefer editing over creating" guidance. |
| `patchFile` | *(closest: `Edit`, but via unified diff)* | ⚠️ Partial | Diff-based editing is more expressive but agents often need targeted string replacements. No equivalent to `Edit`'s `old_string`/`new_string`/`replace_all`. |
| `executeShell` | `Bash` | ⚠️ Weak | Runtime (`ShellTaskRunner`) supports background execution (`src/tasks/shell-task-runner.ts:26-101`) but the tool schema does **not** expose `run_in_background`, `timeout`, or `description` params. Description is one line. |
| `slashCommand` | *(gambit-unique; complements `Skill`)* | ✅ Keep | Workspace-scoped command templates (`.gambit/commands/*.md`). Distinct use case from `Skill`. |
| `activateSkill` | `Skill` | ✅ Parity | Discovers `SKILL.md` under `.gambit/skills/` and `.agents/skills/` (project + user). Catalog embedded in tool description (tier 1); full body returned on activation wrapped in `<skill_content>` with a `<skill_resources>` listing (tier 2); files loaded on demand via `readFile` (tier 3). |
| `readTaskOutput` | `TaskOutput` | ⚠️ Partial | Missing `block` (wait for completion) and `timeout` parameters. Only takes `taskId`. |
| `spawnAgent` | `Task` | ⚠️ Partial | Has `role`, `prompt`, `description`, `background`. Missing: `resume` (continue a previous agent with full context), `model` (override), `max_turns`. Description is a single line vs Claude Code's detailed agent-usage guide. |
| `writeMemory` | *(gambit-unique)* | ✅ Keep | No Claude Code analogue. Part of gambit's memory system. |
| MCP tools | MCP (parity) | ✅ Keep | Already aligned. |

---

## 3. Missing tools (prioritized)

### Tranche 1 — High value, low complexity

| Tool | Rationale | Gambit infra already in place |
|---|---|---|
| **`Grep`** | Ripgrep-backed content search. Agents currently shell out, which is slow and permission-gated. | `executeShell` works but isn't ergonomic. |
| **`Glob`** | File pattern matching sorted by mtime. Core exploration primitive. | None — new impl (can use `Bun.Glob` or `fast-glob`). |
| **`Edit`** | Targeted string replacement, complements `patchFile` for small tweaks. | None — trivial to add alongside `patchFile`. |
| **`KillShell`** | Cancel a background shell task by ID. | `TaskRuntime` already supports cancellation via `AbortSignal`. Just need a tool wrapper. |

### Tranche 2 — Medium value, UI-aware

| Tool | Rationale | Notes |
|---|---|---|
| **`TodoWrite`** | Structured session task list with `pending` / `in_progress` / `completed`. Visible to user. | Requires UI wiring in REPL + headless paths to actually display todos. |
| **`WebFetch`** | Fetch URL, convert to markdown, summarize with a small model. | Needs a fetch client + a cheap model call. 15-min cache per spec. |
| **`AskUserQuestion`** | Multi-choice prompts mid-execution. | Requires interactive UI path; blocks on user input. Needs a headless fallback (fail / default answer). |

### Tranche 3 — External dependencies / larger scope

| Tool | Rationale | Notes |
|---|---|---|
| **`WebSearch`** | Web search for current info. | Needs an external API key (Brave / Tavily / SerpAPI). Surface as optional tool gated on config. |
| **`EnterPlanMode`** / **`ExitPlanMode`** | Two-phase "plan then implement" workflow with user approval gate. | Requires a mode state machine across agent loop + UI. Highest integration cost. |
| **`NotebookEdit`** | Jupyter cell editing. | Niche audience for gambit. Defer unless demand surfaces. |

---

## 4. Recommended description/schema updates (no new tools)

Even without implementing new tools, these alignment changes improve agent behavior at near-zero cost:

1. **`readFile`** — expand description to match `Read`'s: support absolute paths, add `offset`/`limit` params, document binary/image/PDF behavior (even if stubbed). Rename surfaces to `Read` (keep id `readFile` for wire compat, or alias).
2. **`executeShell`** — expose `run_in_background` + `timeout` + `description` params (infra exists). Update description with Claude-Code-style guidance on when NOT to use it (prefer Grep/Glob/Read/Edit/Write).
3. **`spawnAgent`** — add `resume`, `model`, `max_turns`. Rewrite description following Claude Code `Task` template (when to use, when NOT to use, parallel invocation guidance).
4. **`readTaskOutput`** — add `block` (default true) + `timeout` (default 30s, max 600s) params. Update description to cover all task kinds.
5. ~~**`slashCommand`** — restructure description around "skill invocation" semantics so agents treat it symmetrically with Claude Code's `Skill` tool.~~ **Done (differently):** added a dedicated `activateSkill` tool with proper progressive-disclosure semantics (`src/lib/skills.ts`, `src/tools/builtins.ts`). `slashCommand` keeps its distinct workspace-command semantics.

---

## 5. Proposed execution plan

**Tranche 1** first — it's mostly additive, low-risk, and delivers the biggest ergonomic wins for agents (search + targeted edit + kill):

1. Add `Grep` tool (`src/tools/builtins.ts`, backed by ripgrep subprocess or `@vscode/ripgrep`).
2. Add `Glob` tool (Bun.Glob or fast-glob, sorted by mtime).
3. Add `Edit` tool (read file → validate unique `old_string` → replace).
4. Add `KillShell` tool (delegate to `TaskRuntime.cancel(taskId)`).
5. Align descriptions for `readFile`, `executeShell`, `spawnAgent`, `readTaskOutput`, `slashCommand`.
6. Extend `executeShell` schema with `run_in_background` + `timeout` + `description`.

**Tranche 2** — `TodoWrite`, `WebFetch`, `AskUserQuestion`. Touches UI; scope separately.

**Tranche 3** — `WebSearch`, plan mode, `NotebookEdit`. Defer until demand / external API is decided.

---

## 6. Open questions

- Should `patchFile` be kept alongside a new `Edit`, or should `Edit` replace the targeted-replacement use case with `patchFile` reserved for multi-file/rename diffs?
- For `AskUserQuestion` in headless mode: fail, auto-pick first option, or require a pre-supplied answers map?
- For `WebSearch`: which provider? Needs config surface in `gambit.config` or env var.
- Should gambit adopt Claude Code's capitalized tool IDs (`Read`, `Bash`, …) or keep its `camelCase` convention (`readFile`, `executeShell`)? Wire-compat vs agent-familiarity tradeoff.
