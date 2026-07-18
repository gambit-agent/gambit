import { TextAttributes } from '@opentui/core'

import type { MCPServerConfig } from '../../lib/mcp-config'
import { theme } from '../theme'

export interface MCPServerManagerOverlayProps {
  servers: MCPServerConfig[]
}

function formatTransport(config: MCPServerConfig): string {
  if (config.type === 'stdio') {
    const args = (config.args ?? []).join(' ')
    return `stdio · ${config.command ?? '<missing command>'}${args ? ` ${args}` : ''}`
  }
  return `http · ${config.url ?? '<missing url>'}`
}

export function MCPServerManagerOverlay({ servers }: MCPServerManagerOverlayProps) {
  const isEmpty = servers.length === 0
  const message = isEmpty ? null : `${servers.length} server${servers.length === 1 ? '' : 's'} configured.`

  return (
    <box
      style={{
        position: 'absolute',
        left: 0,
        top: 0,
        width: '100%',
        height: '100%',
        justifyContent: 'center',
        alignItems: 'center',
        zIndex: 92,
      }}
    >
      <box
        flexDirection="column"
        gap={1}
        style={{
          border: ['left'],
          borderStyle: 'heavy',
          borderColor: theme.inputBorder,
          padding: 2,
          backgroundColor: theme.header,
          minWidth: 60,
          maxWidth: 100,
        }}
      >
        <text fg={theme.headerAccent} attributes={TextAttributes.BOLD} content="MCP Servers" />
        {message ? <text fg={theme.userFg} content={message} /> : null}
        {isEmpty ? (
          <text
            fg={theme.statusFg}
            attributes={TextAttributes.DIM}
            content="No MCP servers configured. Use `/mcp add` to register one."
          />
        ) : (
          <box flexDirection="column" gap={0}>
            {servers.map((server) => {
              const statusLabel = server.enabled ? 'enabled' : 'disabled'
              const statusColor = server.enabled ? theme.headerAccent : theme.statusFg
              return (
                <box key={server.name} flexDirection="row" gap={1}>
                  <text fg={statusColor} content={`[${statusLabel}]`} />
                  <text fg={theme.userFg} attributes={TextAttributes.BOLD} content={server.name} />
                  <text fg={theme.statusFg} attributes={TextAttributes.DIM} content={formatTransport(server)} />
                </box>
              )
            })}
          </box>
        )}
        <text
          fg={theme.statusFg}
          attributes={TextAttributes.DIM}
          content="Press Esc to close. Use `/mcp list|add|remove|enable|disable` to manage servers."
        />
      </box>
    </box>
  )
}
