# Gambit Rewrite: Target Architecture

## Design Goals

- preserve `gambit` as a local-first CLI/TUI
- preserve OpenTUI as the rendering/runtime layer for the TUI
- preserve Gambit's current visual style, information density, and terminal feel
- preserve OpenRouter as the primary model/provider integration
- port the reference app's durable architecture, not its entire feature catalog
- make tasks, sub-agents, tools, permissions, and memory explicit runtime domains
- reduce the amount of logic living inside `src/App.tsx`
- keep the system testable in small slices

## Non-Goals For The First Rewrite

- remote execution
- bridge mode
- team memory sync
- plugin ecosystem
- voice, browser, PR, or cloud workflow parity
- reproducing every reference command or every reference tool
- porting Ink components or Ink-specific rendering abstractions directly
- replacing Gambit's provider model with an Anthropic-only runtime path
- visually cloning the reference app's TUI

## Guiding Principles

### 1. Bounded contexts first

Every subsystem needs a home:

- app shell
- conversation engine
- task runtime
- agent runtime
- model/provider layer
- tool registry
- permission engine
- memory engine
- session storage
- TUI presentation

### 2. UI reads state, services perform work

UI components should render and dispatch intents.

They should not:

- spawn processes directly
- own transcript persistence
- decide how task notifications work
- evaluate tool permissions
- build retrieval-time memory context

Renderer note:

- OpenTUI components should consume stores and render state
- renderer-specific interaction details must stay in the OpenTUI layer
- state and service logic must remain renderer-agnostic so the Ink reference architecture can be adopted without dragging Ink into the design

### 3. Local-first vertical slices

Start with local-only versions of the new runtime boundaries. Remote and multi-workspace variants can be added later if the contracts are correct.

### 4. File persistence for anything that can outlive one render tree

Persist:

- session transcript
- task transcript/output
- memory index and memory files
- slash command cache if needed
- agent metadata where it affects resume behavior

Do not rely on in-memory React state for resumable work.

### 5. Separate runtime tasks from durable work assignment

Phase one only needs runtime tasks, but the architecture should leave room for a second plane of durable assignable work items.

That means:

- task runtime for live shell and agent execution
- optional future work board for coordinator/swarm assignment and claiming

## Proposed Source Layout

```text
src/
  app/
    bootstrap.ts
    AppShell.tsx
    providers.tsx
  repl/
    ReplScreen.tsx
    input-router.ts
    command-router.ts
  conversation/
    conversation-store.ts
    conversation-runner.ts
    message-model.ts
    transcript.ts
  model/
    provider-types.ts
    provider-registry.ts
    openrouter-provider.ts
    capability-matrix.ts
  tasks/
    task-types.ts
    task-store.ts
    task-events.ts
    shell-task-runner.ts
    agent-task-runner.ts
    task-output.ts
  workboard/
    work-item-types.ts
    work-item-store.ts
    work-item-watcher.ts
  agents/
    agent-definitions.ts
    agent-runner.ts
    agent-progress.ts
    agent-context.ts
  tools/
    tool-types.ts
    tool-registry.ts
    tool-executor.ts
    builtins/
  permissions/
    permission-types.ts
    permission-store.ts
    permission-engine.ts
    permission-rules.ts
  memory/
    memory-types.ts
    memory-paths.ts
    memory-index.ts
    memory-store.ts
    memory-retrieval.ts
    memory-prompt.ts
  session/
    session-paths.ts
    session-store.ts
    jsonl.ts
  ui/
    screens/
    panels/
    overlays/
    components/
```

This layout is intentionally smaller than the reference app but keeps the same main seams.

## Core Runtime Modules

### App shell

Responsibility:

- boot runtime services
- compose providers/stores
- render top-level TUI layout
- own startup and shutdown sequencing

Candidate files:

- `src/app/bootstrap.ts`
- `src/app/AppShell.tsx`

### REPL shell and input router

Responsibility:

- act as the real interactive composition root
- route user input into local commands, model-mediated prompts, or blocking UI flows
- coordinate the conversation runner without owning execution details

OpenTUI note:

- this should be implemented as an OpenTUI-native screen tree
- keyboard handling, overlays, and focus behavior should use OpenTUI primitives and hooks
- no attempt should be made to preserve Ink component structure
- preserve Gambit's current visual language unless a functional requirement forces a UI change

Recommended command categories:

- `prompt`: model-mediated request
- `local`: immediate synchronous logic
- `local-ui`: immediate logic that opens a modal/overlay or blocking UI flow

### Conversation engine

Responsibility:

- maintain message timeline
- translate UI input into model runs
- inject system prompt plus relevant memory context
- resolve provider/model capabilities through the model layer
- coordinate tool execution through the tool executor
- append transcript entries to disk
- drain queued events such as task notifications into the active turn when needed

Important rule:

- conversation state should not own task internals
- it should reference tasks through events and task ids

### Model/provider layer

Responsibility:

- define provider-agnostic request and response contracts
- map `gambit` conversation runs onto OpenRouter request semantics
- expose model capability checks such as tool calling, reasoning support, and context limits
- isolate provider-specific payload shaping away from prompts, tools, and task runtime

Phase-one design target:

- OpenRouter remains the default and first-class provider path
- additional providers are optional future adapters, not a reason to weaken current OpenRouter support
- Anthropic-shaped logic from the reference app is only ported when it can be translated into provider-neutral contracts

### Task runtime

Responsibility:

- register tasks
- update status and progress
- track foreground versus background
- persist task output references
- notify conversation/UI on completion

Minimum phase-one task types:

- `shell`
- `agent`

Deferred task types:

- `remote-agent`
- `workflow`

### Durable work board

Responsibility:

- represent assignable work items separately from live runtime tasks
- support future coordinator/swarm claim/update/list flows
- remain file-backed if later introduced

This bounded context is optional in phase one, but its future existence should shape the task contracts now.

### Agent runtime

Responsibility:

- own sub-agent lifecycle
- start local delegated runs
- stream progress into task state
- write sub-agent transcript/output files
- return completion notifications and structured summaries

Minimum phase-one agent types:

- `default`
- `explorer`
- `worker`

The initial implementation can map all three to the same underlying model/runtime while preserving the type boundary.

### Tool platform

Responsibility:

- register tools with stable metadata
- provide model-facing schema and descriptions
- execute tool calls
- map large results to persisted output references when needed
- emit tool events into both transcript and task progress streams

Important architectural split:

- `tool-registry`: all known tools
- `tool-pool`: tools available for a specific turn or agent
- `tool-executor`: validation, permissions, execution, result mapping

Provider note:

- tool schemas and execution contracts belong in the tool layer
- provider-specific tool-call formatting belongs in the model/provider layer

Minimum built-in tools for the rewrite:

- file read
- file write
- patch/apply diff
- shell command
- slash command
- spawn agent
- task list/get output
- memory write/update helper

### Permission engine

Responsibility:

- evaluate `allow | deny | ask`
- queue approval requests for UI
- apply permission mode rules
- support plan mode and Auto-accept mode cleanly

Phase-one design target:

- no classifier dependency required
- permission checks are deterministic policy plus explicit user approval
- classifier-like automation can be added later as a hint-producing layer

### Memory engine

Responsibility:

- manage typed Markdown memory files
- maintain `MEMORY.md` index
- provide memory instructions for the system prompt
- select relevant memory files per turn

Phase-one memory design:

- storage root: `.gambit/memory/`
- index file: `.gambit/memory/MEMORY.md`
- topic files: `.gambit/memory/*.md`
- supported types: `user`, `feedback`, `project`, `reference`

## Domain Contracts

### Task record

```ts
type TaskKind = 'shell' | 'agent'
type TaskStatus = 'pending' | 'running' | 'completed' | 'failed' | 'cancelled'

interface TaskRecord {
  id: string
  kind: TaskKind
  title: string
  status: TaskStatus
  background: boolean
  createdAt: string
  startedAt?: string
  finishedAt?: string
  progressSummary?: string
  outputPath?: string
  transcriptPath?: string
  error?: string
  metadata?: Record<string, unknown>
}
```

### Work item record

Optional future durable assignment model:

```ts
interface WorkItemRecord {
  id: string
  title: string
  description: string
  status: 'pending' | 'claimed' | 'completed' | 'blocked'
  ownerAgentId?: string
  blockedBy?: string[]
  metadata?: Record<string, unknown>
}
```

### Agent definition

```ts
interface AgentDefinition {
  id: string
  role: 'default' | 'explorer' | 'worker'
  description: string
  systemPromptAddendum?: string
  allowedToolIds?: string[]
}
```

### Tool definition

```ts
interface ToolDefinition<I, O> {
  id: string
  displayName: string
  description: string
  inputSchema: ZodSchema<I>
  execute: (input: I, context: ToolExecutionContext) => Promise<O>
  summarize?: (result: O) => string
  shouldPersistLargeResult?: boolean
}
```

### Memory record

```md
---
name: user_prefers_terse_updates
description: User prefers terse progress updates and no long end summaries
type: feedback
updated: 2026-03-31
---

User prefers terse progress updates.

Why: Long recap text is noise for this user.
How to apply: Keep progress updates short and final responses compact.
```

## Primary Flows

### Main prompt flow

1. user input enters conversation runner
2. system prompt is built
3. relevant memory selection runs
4. final model context is assembled
5. tool calls go through tool executor
6. tool executor may create or update tasks
7. transcript is appended throughout the run

### Input router flow

1. user input enters `ReplScreen`
2. command router categorizes the input as `prompt`, `local`, or `local-ui`
3. local handlers run immediately without entering the model loop
4. prompt handlers assemble context and call the conversation runner

### Shell task flow

1. model or user requests shell execution
2. permission engine resolves allow or approval
3. task runtime registers a `shell` task
4. shell task runner streams stdout/stderr and updates progress
5. output is persisted if large
6. completion updates task state and emits notification

### Agent task flow

1. model calls spawn-agent tool
2. permission engine resolves delegation
3. task runtime registers an `agent` task
4. agent runner launches a local delegated conversation with constrained tools
5. sub-agent transcript and output are persisted
6. task completion produces a summary/result attachment

### Memory retrieval flow

1. current user turn text is passed to memory retrieval
2. memory index/frontmatter scan builds candidate set
3. retrieval selects the most relevant files
4. selected memory contents are attached as context
5. prompt policy reminds the model how and when to write memory

## UI Boundaries

`AppShell` should render:

- conversation pane
- prompt input
- status line
- task panel
- permission dialog queue
- overlays such as model picker

Task-specific and permission-specific components should subscribe to their own stores rather than receiving the entire runtime state from `App.tsx`.

Renderer mapping guidance:

- Ink `REPL` maps conceptually to an OpenTUI `ReplScreen`
- Ink dialogs and overlays map to OpenTUI overlays/panels, not necessarily modal components with the same shape
- transcript, prompt input, task panel, and permission queue should be rebuilt as OpenTUI-first components backed by shared stores
- any cross-renderer logic belongs in stores/services, not in UI components

Style guidance:

- preserve Gambit's existing theme, spacing rhythm, and overall tone where possible
- import the reference app's behavior and interaction model, not its visual presentation
- any new panels or overlays should feel native to Gambit's current interface rather than like an embedded foreign UI

## Migration Compatibility Strategy

During the rewrite, keep compatibility adapters so existing behavior does not disappear all at once:

- current `agentTools` can be wrapped by a new tool registry
- current slash command loader can stay in place behind a new tool adapter
- current memory append command can be replaced by a memory-engine facade before the UI changes
- current `App.tsx` can call into new stores and services incrementally

## First Implementation Target

The first target architecture milestone is reached when:

- `App.tsx` no longer directly owns shell process spawning
- the real interactive root is a dedicated REPL shell component
- delegated-agent runs go through the task runtime
- permissions go through a queue/store
- memory uses file-based typed records instead of JSONL
- transcripts and task outputs are persisted through a session layer
