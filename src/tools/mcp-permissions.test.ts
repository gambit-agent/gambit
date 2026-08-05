import { expect, test } from 'bun:test'

import { mcpManagementTools } from './mcp'

/**
 * The execution pipeline skips permission evaluation for any tool without a
 * getPermissionRequest. call-mcp-tool can invoke an arbitrary tool on a
 * configured MCP server, so a missing callback there is an approval bypass.
 */
test('call-mcp-tool requests permission before invoking a server tool', async () => {
  const callTool = mcpManagementTools.find((tool) => tool.id === 'call-mcp-tool')
  expect(callTool).toBeTruthy()
  expect(typeof callTool!.getPermissionRequest).toBe('function')

  const request = await callTool!.getPermissionRequest!({
    serverName: 'files',
    toolName: 'delete_everything',
    arguments: { path: '/' },
  })

  expect(request).toBeTruthy()
  expect(request!.subject).toContain('files')
  expect(request!.subject).toContain('delete_everything')
  expect(request!.metadata).toMatchObject({
    serverName: 'files',
    toolName: 'delete_everything',
  })
})

test('every state-changing MCP management tool requests permission', () => {
  const mutating = ['call-mcp-tool', 'add-mcp-server', 'remove-mcp-server', 'toggle-mcp-server']
  for (const id of mutating) {
    const tool = mcpManagementTools.find((candidate) => candidate.id === id)
    // Fail loudly if a tool is renamed away rather than silently passing.
    expect({ id, found: Boolean(tool) }).toEqual({ id, found: true })
    expect({ id, hasPermission: typeof tool!.getPermissionRequest === 'function' }).toEqual({
      id,
      hasPermission: true,
    })
  }
})
