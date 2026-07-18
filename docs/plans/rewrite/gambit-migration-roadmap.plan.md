# Gambit Rewrite: Migration Roadmap

## Strategy

Rewrite `gambit` in vertical slices, not by freezing the app and trying to transplant a 600k-line architecture wholesale.

Each phase should:

- introduce one durable runtime seam
- keep the app runnable
- add tests around the new seam
- reduce logic inside `src/App.tsx`
- keep renderer-specific work isolated to OpenTUI presentation layers
- keep provider-specific work isolated to a model/provider layer
- preserve Gambit's current visual identity while functionality expands

## Phase 0: Lock The Rewrite Scope

Objective:

- define what is in and out for the first architecture port

Deliverables:

- this roadmap
- target architecture doc
- reference architecture audit

Exit criteria:

- team agrees phase-one parity means local tasks, local sub-agents, permissions, and file-based memory
- remote/cloud/team-sync features are explicitly deferred
- renderer migration policy is explicit: architecture ports from Ink, UI rebuilt in OpenTUI
- model-provider policy is explicit: OpenRouter remains the primary provider path
- visual policy is explicit: Gambit keeps its current look while importing runtime features

## Phase 1: Introduce Runtime Stores And Session Paths

Objective:

- create non-UI homes for conversation, tasks, permissions, and session storage

Work items:

1. add `src/session/` with path helpers for:
   - current session directory
   - transcript path
   - tasks directory
   - task output directory
2. add `src/tasks/task-store.ts`
3. add `src/permissions/permission-store.ts`
4. add `src/conversation/conversation-store.ts`
5. create `src/model/` with provider contract placeholders and an OpenRouter adapter boundary
6. move JSONL helpers that will be reused into `src/session/`
7. create a `src/repl/` boundary for the future input router and interactive shell

Tests:

- session path generation
- task store create/update/remove
- permission queue enqueue/dequeue

Exit criteria:

- stores can be used without React components
- no file path logic is hidden inside `App.tsx`
- OpenRouter-specific logic has an explicit home even if behavior has not moved there yet

## Phase 2: Build The Tool Registry Layer

Objective:

- replace the flat `agentTools` export with an internal tool-definition system

Work items:

1. define `ToolDefinition` and `ToolExecutionContext`
2. wrap existing tools:
   - read file
   - write file
   - patch file
   - shell
   - slash command
3. add a `tool-registry.ts`
4. add a `tool-executor.ts`
5. add consistent tool event objects for transcript and UI rendering

Tests:

- tool registration and lookup
- schema validation failures
- tool event serialization
- large result handling policy

Exit criteria:

- conversation runner depends on the tool executor, not directly on AI SDK tool objects

## Phase 2.5: Isolate The Model Provider Layer

Objective:

- separate provider contracts from conversation, tool, and prompt logic before deeper feature ports

Work items:

1. define provider-neutral request and response types
2. move current OpenRouter request assembly behind `src/model/openrouter-provider.ts`
3. add capability checks for tool calling and model-specific behavior
4. ensure prompt assembly does not depend on Anthropic-shaped message assumptions
5. keep a compatibility adapter so current model selection still works during migration

Tests:

- provider request mapping
- capability detection
- model selection compatibility

Exit criteria:

- OpenRouter remains fully functional through the new provider layer
- imported architecture no longer depends on Anthropic-specific request shapes

## Phase 3: Extract The Permission Engine

Objective:

- make approvals and permission modes explicit

Work items:

1. define permission decision types:
   - `allow`
   - `deny`
   - `ask`
2. move plan mode / Auto-accept mode out of the interactive controller and into permission state
3. add a permission queue that UI renders
4. route shell and agent delegation through the permission engine
5. add a basic approval dialog component backed by the queue

Tests:

- mode transitions
- approval queue behavior
- allow/deny/ask routing
- aborted request cleanup

Exit criteria:

- shell and agent delegation no longer decide permissions inline inside `App.tsx`

## Phase 4: Build The Task Runtime

Objective:

- represent long-running work as tasks

Work items:

1. define task types and statuses
2. add task registration/update helpers
3. create a task panel component
4. add disk-backed task output paths
5. convert background shell execution into a `shell` task

Tests:

- shell task lifecycle
- output path creation
- completion and failure transitions
- task notification events

Exit criteria:

- background shell state is removed from `App.tsx`
- shell work appears through the task runtime

## Phase 4.5: Reserve The Work-Board Boundary

Objective:

- prevent future coordinator/swarm work from being forced into the runtime task store

Work items:

1. define an optional `WorkItemRecord` model
2. create a placeholder file-backed work-board module, even if it is not user-facing yet
3. keep runtime task ids and work-item ids distinct

Tests:

- work-item serialization
- separation between task state and work-item state

Exit criteria:

- the codebase has an explicit place for future durable assignment logic

## Phase 5: Create The Local Agent Runtime

Objective:

- make delegated agents a first-class runtime instead of ad hoc recursion

Work items:

1. define `AgentDefinition`
2. add `spawn-agent` as a first-class tool in the new registry
3. create `agent-task-runner.ts`
4. persist sub-agent transcript and output files
5. track progress summary and completion notification
6. support at least these roles:
   - `default`
   - `explorer`
   - `worker`

Constraints:

- local only
- same workspace only
- no worktree isolation yet
- no remote execution yet

Tests:

- agent task creation and completion
- progress updates
- transcript persistence
- permission gating for delegation

Exit criteria:

- delegated agent runs no longer share the same runtime path as the main conversation
- agent output survives UI refresh or task panel changes

## Phase 6: Replace JSONL Memory With Typed File-Based Memory

Objective:

- port the reference app's useful memory architecture without its full complexity

Work items:

1. create `.gambit/memory/`
2. create typed memory file format with frontmatter:
   - `name`
   - `description`
   - `type`
   - `updated`
3. create `.gambit/memory/MEMORY.md` as an index
4. add `memory-prompt.ts` for policy text
5. add memory scan and retrieval logic
6. replace the current append-only memory writer with index-aware file writes

Phase-one memory behavior:

- allow direct memory writes by the main agent or slash command
- retrieve only the most relevant memory files per turn
- no team sync
- no daily log consolidation
- no auto-extraction worker unless time allows

Tests:

- memory file parsing
- index generation/update
- relevant-memory selection heuristics
- backward migration from existing JSONL if implemented

Exit criteria:

- `src/lib/memory.ts` JSONL append model is retired or reduced to a migration helper
- memory participates in prompt assembly, not just storage

## Phase 7: Split `App.tsx` Into App Shell And Panels

Objective:

- move the runtime composition out of the monolithic component

Work items:

1. create `AppShell.tsx`
2. create a dedicated `ReplScreen.tsx` as the true interactive root
3. move conversation rendering into a conversation panel
4. move task rendering into a task panel
5. move permission rendering into a permission overlay
6. keep model picker as its own overlay
7. simplify `src/App.tsx` into a composition entry or retire it
8. rebuild these surfaces with OpenTUI-native primitives instead of mirroring Ink component structure
9. preserve Gambit's existing visual language while adding task and permission surfaces

Tests:

- render smoke tests for shell
- interaction tests around task and permission panels

Exit criteria:

- runtime logic is mostly outside UI components
- top-level UI is compositional rather than monolithic
- renderer-specific concerns are confined to OpenTUI screen/panel components

## Phase 8: Add Resume-Safe Persistence And Recovery

Objective:

- make background task and delegated-agent state recoverable

Work items:

1. persist task metadata to disk
2. restore running/completed tasks on startup
3. restore transcript references for delegated agents
4. ensure large outputs remain inspectable after restart

Tests:

- persisted task metadata round trip
- session reload with completed tasks
- transcript reload for delegated agents

Exit criteria:

- background work is not purely ephemeral

## Phase 9: Add Nice-To-Have Parity Features

Only start this phase after the earlier phases are stable.

Candidate features:

- automatic memory extraction worker
- worktree-isolated agent tasks
- richer tool search/discovery
- larger tool set
- task list slash commands
- team memory or shared memory scope

## Concrete Implementation Order

If work begins immediately, use this sequence:

1. create session/task/permission stores
2. isolate the OpenRouter provider boundary
3. wrap current tools in the new tool registry
4. route shell execution through permissions and task runtime
5. reserve the work-board boundary
6. add local delegated-agent runtime
7. add file-based memory engine and retrieval
8. split UI into shell + panels
9. add persistence/resume

This order creates useful behavior early while preventing a second giant `App.tsx`.

## Suggested First PR Stack

### PR 1

- add session paths
- add task store
- add permission store
- no behavior changes

### PR 2

- add provider-neutral model interfaces
- move OpenRouter request handling behind the provider layer

### PR 3

- add tool registry and tool executor
- adapt existing tools behind new contracts

### PR 4

- convert shell execution to permission + task runtime

### PR 5

- add local delegated-agent task runner

### PR 6

- replace JSONL memory with typed memory files and retrieval

### PR 7

- split UI into app shell, task panel, and permission overlay

## Risks And Controls

Risk:

- rewriting too much at once and breaking the app

Control:

- keep vertical slices runnable and testable

Risk:

- copying reference complexity that `gambit` does not need

Control:

- only port local-first architecture in phase one

Risk:

- accidentally designing around Ink assumptions and fighting OpenTUI during implementation

Control:

- port behavior and state flow only
- rebuild transcript, input, dialogs, and panels using OpenTUI-native patterns

Risk:

- Anthropic-specific assumptions from the reference app leak into model execution or prompt assembly and regress OpenRouter support

Control:

- isolate provider logic early
- require provider-neutral contracts for prompts, tools, and conversation runs
- keep OpenRouter functional at every migration phase

Risk:

- memory rewrite creates incompatible storage

Control:

- add a one-time importer from existing JSONL if needed
- keep old file untouched until migration succeeds

Risk:

- delegated-agent runtime grows without clear task contracts

Control:

- require every delegated run to be represented by a task record and transcript path from day one

## Definition Of Success

The rewrite is successful when `gambit` has these properties:

- `App.tsx` is no longer the execution core
- shell and delegated work are task-backed
- permissions are explicit and UI-driven
- memory is typed, file-based, and selectively retrieved
- tool registration is stable and extensible
- OpenRouter remains the active provider path behind a cleaner abstraction
- session and task artifacts survive beyond one render cycle
