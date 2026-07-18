# Gambit Rewrite: Reference Architecture Audit

## Goal

Use the functional reference app at `C:\Users\sergi\Downloads\src` as an architecture source, not as a line-by-line port target.

The reference codebase is much larger than `gambit` and includes many product surfaces that `gambit` does not need yet. The rewrite should extract the durable architectural ideas:

- preserve Gambit's current OpenTUI visual identity while changing internals behind it
- preserve Gambit's OpenRouter-first model integration
- first-class task runtime
- real sub-agent lifecycle management
- bounded tool platform
- explicit permission flow
- file-based memory with retrieval
- clearer runtime seams between UI, conversation loop, storage, and execution

## Renderer Constraint

The reference app is built around Ink-style TUI composition. `gambit` is built on OpenTUI React.

This changes what can be ported directly:

- port the runtime architecture, state boundaries, and interaction model
- do not port component trees, Ink-specific hooks, or renderer-specific layout code directly
- treat the reference TUI as a behavioral reference, not a UI implementation source

What is transferable:

- thin provider shell plus real REPL root
- input router and command pipeline
- task panel, permission queue, overlays, and transcript surfaces as concepts
- store boundaries and event flow

What is not transferable 1:1:

- Ink component APIs
- Ink-specific focus and render lifecycle assumptions
- renderer-specific keyboard handling details
- any component code that depends on the reference repo's custom Ink wrappers

## Model Provider Constraint

The reference app is shaped around Anthropic-native prompt and tool flows. `gambit` already supports OpenRouter and should keep that as the primary provider path.

This changes what can be ported directly:

- port provider-agnostic runtime boundaries such as prompt assembly, tool execution, task handling, and sub-agent lifecycle
- do not port Anthropic-only request builders, message formats, or system-prompt assumptions directly
- keep provider-specific model capability handling behind a dedicated `gambit` provider layer

What is transferable:

- layered prompt assembly
- tool registry and tool execution contracts
- task-backed agent delegation
- permission and memory architecture

What is not transferable 1:1:

- Anthropic-specific API payload shapes
- Anthropic-only model capability assumptions
- any logic that assumes a single provider controls tool calling semantics

## Current Gambit Baseline

`gambit` is currently a compact single-app implementation:

- `src/App.tsx` owns UI state, request lifecycle, model selection, tool event rendering, background shell state, slash command execution, and memory append behavior.
- `src/tools/index.ts` exposes a small set of direct model tools: read, write, patch, shell, slash command.
- `src/lib/memory.ts` is append-only JSONL under `.gambit/memories/memories.jsonl`.
- `src/lib/interactive/controller.tsx` handles keyboard flow and local permission mode state, but there is no real permission engine or task graph.
- there is no durable task registry, no sub-agent store, no task output persistence layer, and no separable runtime shell for local versus delegated work.

This is a good prototype shape, but it is the wrong shape for porting the reference system's architecture.

## What The Reference App Actually Does

### 1. Runtime shell and composition

The reference app starts with a thin CLI bootstrap layer and then composes a much larger runtime around state, providers, tools, permissions, and session services.

Observed characteristics:

- lightweight entrypoint dispatch in `src/entrypoints/cli.tsx`
- large runtime assembly in `src/main.tsx`
- `src/components/App.tsx` is intentionally thin
- the real interactive composition root is `src/screens/REPL.tsx`
- app state and providers are separated from the interactive surface
- user input follows an explicit router pipeline instead of being handled inline in the top-level component
- many systems are feature-gated, but the important pattern is not the features, it is the separation of concerns

Implication for `gambit`:

- stop treating `App.tsx` as the only runtime boundary
- introduce an application shell that wires stores, services, tools, memory, and UI separately
- introduce an explicit REPL/input pipeline layer between the shell and the model loop
- preserve OpenTUI as the renderer while reproducing the same runtime boundaries behind it

### 2. Tasks are first-class runtime objects

The reference app has two task planes. They are related, but they are not the same thing.

Runtime task plane:

- live execution state in app/session state
- background shell jobs
- local delegated agents
- remote agents
- in-process teammates

Durable task-board plane:

- file-backed assignable work items
- claim/update/list/get behavior
- coordination across teammates or swarm workers
- separate watchers and UI state

The important lesson is to not collapse these into one model.

The reference app models work as tasks instead of ad hoc UI state.

Observed task concepts:

- multiple runtime task types: local shell, local agent, remote agent, main-session background task, and others
- task registration and updates go through shared task helpers
- task state carries status, progress, output location, visibility, notification state, and ownership
- task lists are persisted and watched by a dedicated store
- background versus foreground is explicit state, not just a UI hint
- a separate durable task board exists for work assignment and claiming

Representative files:

- `src/tasks/types.ts`
- `src/tasks/LocalMainSessionTask.ts`
- `src/tasks/LocalAgentTask/LocalAgentTask.tsx`
- `src/tasks/RemoteAgentTask/RemoteAgentTask.tsx`
- `src/hooks/useTasksV2.ts`
- `src/utils/tasks.ts`
- `src/hooks/useTaskListWatcher.ts`

Implication for `gambit`:

- add a real task runtime before attempting a deep port of sub-agents or shell backgrounding
- treat shell commands, delegated agents, and long-running prompt work as the same class of thing: task instances with typed state
- keep any future coordinator/swarm work board separate from the runtime task store

### 3. Sub-agents are a runtime, not just a tool call

In the reference app, the agent-launch tool is only the front door. The real architecture lives in the task runtime, transcript persistence, progress reporting, and result delivery.

Observed sub-agent behavior:

- `AgentTool` can launch local agents, remote agents, background agents, and isolated worktree flows
- spawned work becomes a task with its own transcript and output file
- progress is tracked from tool activity and token usage
- notifications are queued when background work finishes
- foreground and background transitions are first-class operations

Representative files:

- `src/tools/AgentTool/AgentTool.tsx`
- `src/tools/AgentTool/agentToolUtils.ts`
- `src/tasks/LocalAgentTask/LocalAgentTask.tsx`
- `src/tasks/RemoteAgentTask/RemoteAgentTask.tsx`
- `src/tools/shared/spawnMultiAgent.ts`

Implication for `gambit`:

- the first rewrite goal is not "spawn lots of agent types"
- the first rewrite goal is "make one local delegated agent type robust"
- remote agents and worktree isolation should be phase-two or phase-three capabilities

### 4. Tools are a platform

The reference app does not treat tools as a flat map.

Observed tool-platform concepts:

- a central tool interface plus `buildTool`-style definitions
- tools provide description, prompt, schemas, UI renderers, result mapping, and execution behavior
- registry and pool assembly are separate concerns
- tool pools are assembled and filtered based on context and permissions
- deferred tools can be surfaced through search instead of always injecting every schema
- large results are persisted to disk and referenced instead of always staying inline
- tool schema caching exists because prompt/tool stability matters

Representative files:

- `src/Tool.ts`
- `src/tools.ts`
- `src/hooks/useMergedTools.ts`
- `src/utils/toolPool.ts`
- `src/utils/toolSearch.ts`
- `src/utils/toolSchemaCache.ts`
- `src/utils/toolResultStorage.ts`
- `src/tools/...`

Implication for `gambit`:

- replace the current direct AI SDK tool map with a richer internal tool definition layer
- keep the first implementation small, but build the tool contracts so new tools do not increase `App.tsx` complexity
- keep registry, pool assembly, execution, permissions, and UI rendering as separate layers

### 5. Permissions are their own engine

The reference app has a real permission pipeline:

- permission evaluation returns `allow`, `deny`, or `ask`
- interactive flows, coordinator flows, and automated checks are separated
- bash classifier checks are treated as assistive signals, not as the only source of truth
- UI request queues and callbacks are explicit

Representative files:

- `src/hooks/useCanUseTool.tsx`
- `src/hooks/toolPermission/PermissionContext.ts`
- `src/hooks/toolPermission/handlers/interactiveHandler.ts`
- `src/hooks/toolPermission/handlers/coordinatorHandler.ts`
- permission request UI under `src/components/permissions`

Implication for `gambit`:

- do not bury plan mode / Auto-accept mode / confirmations inside the keyboard controller
- create a permission service with request objects, decisions, and a queue that UI renders

### 6. Memory is a system, not a log

The memory explorer confirmed the largest gap between the two codebases.

Observed memory architecture:

- durable file-based memory rather than JSONL append-only storage
- `MEMORY.md` acts as an index, not the storage body
- individual memory files have frontmatter with `name`, `description`, and `type`
- typed memory taxonomy: `user`, `feedback`, `project`, `reference`
- memory policy and storage layout are separate from retrieval
- prompt injection, index loading, and relevant-memory retrieval are separate paths
- retrieval uses a selective relevance pass, not "load everything"
- update paths include direct writes by the main agent and background extraction flows

Representative files:

- `src/memdir/memdir.ts`
- `src/memdir/memoryTypes.ts`
- `src/memdir/memoryScan.ts`
- `src/memdir/findRelevantMemories.ts`
- `src/memdir/paths.ts`

Implication for `gambit`:

- replace JSONL memory with typed Markdown memory files plus an index
- keep phase one simpler than the reference app:
  - no team sync
  - no dream consolidation
  - no per-agent memory scope
- but do preserve the key split:
  - storage
  - memory prompt policy
  - retrieval-time relevance selection

### 7. Disk output and transcript persistence matter

The reference app persists task outputs and transcripts so background work can be resumed, surfaced, and inspected.

Observed patterns:

- task outputs have stable file paths
- notifications reference task output files
- background work can complete after the user has moved on
- UI and model can both reason about task completion through persisted artifacts

Implication for `gambit`:

- introduce a session storage layer early
- persist delegated-agent transcripts and task summaries to disk
- background features should never depend on in-memory React state alone

## What Gambit Should Port Now

Port now:

- runtime shell separation
- typed runtime task store
- local delegated-agent lifecycle
- internal tool definition layer
- permission queue and decision engine
- typed file-based memory with selective retrieval
- persisted task output and transcript files

Defer until later:

- remote/cloud agents
- worktree isolation
- durable shared task board for coordinator/swarm work assignment
- team memory sync
- daily log consolidation or dream passes
- plugin marketplace, bridge mode, voice, PR-specific workflows
- very broad command surface

## Recommended Rewrite Strategy

Do not incrementally bolt the reference architecture onto the current `App.tsx`.

Instead:

1. keep the current app functional while introducing new subsystems beside it
2. create typed runtime services for tasks, permissions, memory, tools, and sessions
3. isolate provider-specific model logic behind an OpenRouter-first model boundary
4. migrate one vertical slice at a time:
   - shell task
   - local delegated agent
   - memory retrieval
5. move UI to consume stores and services instead of owning execution logic
6. rebuild the TUI surfaces in OpenTUI-native components rather than trying to transliterate Ink components
7. preserve the current `gambit` visual language instead of visually copying the reference app

## Architectural Cut Line For Phase One

Phase-one parity target:

- one main conversation session
- one local sub-agent runtime
- one background shell task runtime
- one tool registry
- one permission queue
- one file-based memory engine with relevant-memory retrieval

This is enough to reshape `gambit` into the same architectural family as the reference app without importing its entire product scope.
