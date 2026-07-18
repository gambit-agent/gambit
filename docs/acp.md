# Agent Client Protocol (ACP)

Gambit can run as an ACP v1 external agent for editors and other ACP clients. The
server uses newline-delimited JSON-RPC over standard input and output.

## Start the server

```bash
gambit acp
```

The client supplies the absolute workspace directory when it creates or resumes a
session. Configure provider credentials with Gambit's `/connect` flow before
starting the ACP process. Model selection itself is available inside ACP clients.

## Configure Zed

Open Agent Settings with `agent: open settings`, go to **External Agents**, choose
**Add Agent**, then **Add Custom Agent**. See Zed's
[External Agents documentation](https://zed.dev/docs/ai/external-agents) for the
client workflow. The equivalent `settings.json` entry for an installed Gambit
binary is:

```json
{
  "agent_servers": {
    "gambit": {
      "type": "custom",
      "command": "gambit",
      "args": ["acp"],
      "env": {}
    }
  }
}
```

If Zed cannot resolve Gambit from `PATH`, use the absolute path to `gambit` or
`gambit.exe`. For development from this repository, point `command` at Bun and use
the absolute source entry point:

```json
{
  "agent_servers": {
    "gambit-dev": {
      "type": "custom",
      "command": "C:\\path\\to\\bun.exe",
      "args": ["run", "C:\\path\\to\\gambit\\src\\gambit.tsx", "acp"],
      "env": {}
    }
  }
}
```

Restart the external-agent process and open a new Gambit thread after changing the
server or its advertised capabilities. In Zed, `dev: open acp logs` shows the ACP
messages exchanged with Gambit.

## Models and session configuration

Gambit exposes three ACP session configuration options:

- **Model** (`category: model`) — loaded from the same fallback and live provider
  catalogs as the TUI. The selected model is persisted in the workspace's Gambit
  model-selection file.
- **Permission mode** (`category: mode`) — Normal, Auto-accept, or Plan.
- **Reasoning effort** (`category: thought_level`) — Default or a supported Gambit
  reasoning level.

The model catalog is returned immediately with known models, then refreshed after
live provider discovery. `/model` reports the current model, and
`/model <model-id>` changes it without sending the command to the language model.

## Slash commands

On new and resumed sessions Gambit publishes an ACP
`available_commands_update`. It includes the canonical built-in catalog plus
project and user commands loaded from `.gambit/commands`.

| Commands | ACP behavior |
| --- | --- |
| `/help` | Lists the commands advertised for the current workspace. |
| `/model [model-id]` | Shows or changes the active model. |
| `/clear`, `/reset` | Clears Gambit's context while retaining the ACP session identity. |
| `/goal`, `/workflow`, `/skill`, `/compact`, `/tree` | Use Gambit's headless command path; commands that produce prompts continue through the normal model turn. |
| Project/user custom commands | Expand and execute through the same command and hook machinery as headless mode. |
| `/connect`, `/resume`, `/themes`, `/mcp`, `/fork` | Are advertised for catalog parity and return ACP-specific guidance because their interactive UI or session ownership belongs to Gambit TUI or the client. |

## Supported protocol surface

- ACP initialization and protocol-version negotiation.
- Session create, list, resume, and close.
- Prompt turns and cancellation.
- Text, text resources, resource links, and image content blocks.
- Streaming assistant message and tool-call lifecycle updates.
- Client-side permission requests for permission-gated Gambit tools.
- Session configuration and configuration-update notifications.
- Slash-command discovery.
- Stdio transport using newline-delimited JSON-RPC.

## Current limitations

Gambit implements the ACP baseline needed for external-agent use, but does not yet
implement every optional ACP feature:

- One ACP process binds to the first workspace it receives. Start another process
  for a different workspace.
- Additional workspace directories and client-supplied MCP servers are rejected.
  MCP servers already configured in Gambit remain available.
- Audio blocks and binary embedded resources are not supported.
- ACP authentication methods, client filesystem delegation, client terminals,
  agent-plan updates, and native ACP session modes are not advertised.
- The only transport is stdio; HTTP and WebSocket transports are not exposed by
  the CLI.
- Slash-command changes are discovered when a session is created or resumed. Open
  a new thread or resume the session after adding command files.

These omissions are optional protocol surfaces; clients must rely on the
capabilities Gambit returns during initialization and session setup.
