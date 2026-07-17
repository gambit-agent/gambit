# MCP Implementation Progress

## Completed

### 1. Core MCP Infrastructure
- `@modelcontextprotocol/client` (with its peer `@cfworker/json-schema`) wired in.
- `src/lib/mcp-config.ts` loads/saves `~/.gambit/mcp-servers.json` using `fs.mkdirSync({recursive:true})`.
- Config supports `stdio` and `streamable-http` transports plus an `auth` block (bearer token, api key, custom headers).
- Client lifecycle: `getOrCreateMCPClient` caches connected clients with in-flight promise deduping; `cleanupMCPClient` / `cleanupAllMCPClients` close cleanly on `SIGINT` / `SIGTERM` from `src/gambit.tsx`.

### 2. Built-in MCP Management Tools
`src/tools/mcp.ts` exposes `mcpManagementTools`:
- `list-mcp-resources`, `read-mcp-resource`
- `list-mcp-tools`, `call-mcp-tool`
- `list-mcp-servers`, `add-mcp-server`, `remove-mcp-server`, `toggle-mcp-server`

Calls now use the correct object-form API (`callTool({ name, arguments })`, `readResource({ uri })`). Call results are flattened across text/image/audio/resource parts.

### 3. Automatic Tool Discovery
- `discoverMCPTools()` connects to every enabled server, lists its tools, and produces a Gambit `ToolDefinition` per tool.
- Each discovered tool is namespaced as `mcp__<server>__<tool>` to avoid collisions.
- `createBuiltInToolDefinitions({ discoverMCPServerTools: true })` folds discovered tools into the registry. `conversation-runner` turns this on so the main agent sees MCP tools as first-class.
- Discovery failures are logged and isolated per server — a broken server doesn't block the rest.

### 4. TUI Integration
- `/mcp` slash command (`.gambit/commands/mcp.md`) lets the model manage servers via natural language, routing to the management tools.
- `:mcp` colon command opens a new overlay at `src/ui/overlays/MCPServerManagerOverlay.tsx` listing every configured server (status, transport, target). Esc closes.
- `ReplScreen` wires the overlay state, keyboard escape handling, and the colon route.

### 5. Authentication Support
- `MCPServerConfig.auth` accepts `bearerToken`, `apiKey` (+ optional `headerName`), or arbitrary `customHeaders`.
- `buildTransport` merges these into `StreamableHTTPClientTransport`'s `requestInit.headers`.
- `add-mcp-server` tool accepts `bearerToken`, `apiKey`, `apiKeyHeader` for easy setup.

## Remaining / Deferred

- **OAuth2 flow**: the SDK ships `selectClientAuthMethod`, `fetchToken`, and `ClientCredentialsProvider`, but no interactive/browser dance is wired. Static tokens/headers are supported today.
- **Resource subscriptions**: `Client.subscribeResource` exists but the UI has no long-lived subscription manager yet.
- **Prompt/template integration**: `Client.listPrompts` / `Client.getPrompt` are not surfaced as Gambit slash commands.
- **Progress reporting**: long-running MCP tool calls do not stream progress to the task panel.

## Files Touched

1. `src/lib/mcp-config.ts` – config schema + persistence (dir creation bug fixed, auth added).
2. `src/tools/mcp.ts` – client lifecycle, management tools, tool discovery, cleanup.
3. `src/tools/builtins.ts` – wires management + discovered tools into the registry.
4. `src/tools/index.ts` – forwards `discoverMCPServerTools` through `createRuntimeToolRegistry`.
5. `src/conversation/conversation-runner.ts` – enables MCP tool discovery for the chat loop.
6. `src/ui/overlays/MCPServerManagerOverlay.tsx` – new overlay.
7. `src/repl/ReplScreen.tsx` – overlay state, escape handling, `:mcp` route.
8. `src/gambit.tsx` – shutdown cleanup (unchanged, already in place).
9. `.gambit/commands/mcp.md` – `/mcp` slash command.
10. `package.json` / `bun.lock` – adds `@cfworker/json-schema`.

## Verification

- `bun tsc --noEmit` – clean.
- `bun test` – 68 pass, 0 fail.
- `bun build src/gambit.tsx --target=bun --outdir=/tmp/gambit-build` – succeeds.
