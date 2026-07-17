import { Client, StreamableHTTPClientTransport } from '@modelcontextprotocol/client'
import { StdioClientTransport } from '@modelcontextprotocol/client/stdio'
import { z, type ZodTypeAny } from 'zod'

import {
  addMCPServer,
  getMCPServer,
  listEnabledMCPServers,
  listMCPServerConfigs,
  removeMCPServer,
  updateMCPServer,
  type MCPServerConfig,
} from '../lib/mcp-config'
import type { ToolDefinition } from './tool-types'

type AnyTransport = StdioClientTransport | StreamableHTTPClientTransport

interface CachedClient {
  client: Client
  transport: AnyTransport
}

const clientCache = new Map<string, CachedClient>()
const clientPromises = new Map<string, Promise<Client>>()

interface DiscoveryCacheEntry {
  tools?: ToolDefinition<any, any>[]
  failureExpiresAt?: number
}
const discoveryCache = new Map<string, DiscoveryCacheEntry>()
const DISCOVERY_FAILURE_TTL_MS = 60_000

const MCP_TOOL_ID_SEPARATOR = '__'
const MCP_TOOL_ID_PREFIX = `mcp${MCP_TOOL_ID_SEPARATOR}`

function formatMCPToolId(serverName: string, toolName: string): string {
  return `${MCP_TOOL_ID_PREFIX}${sanitizeIdentifier(serverName)}${MCP_TOOL_ID_SEPARATOR}${sanitizeIdentifier(toolName)}`
}

function sanitizeIdentifier(value: string): string {
  return value.replace(/[^A-Za-z0-9_-]/g, '_')
}

function formatResourceUri(serverName: string, uri: string): string {
  return `mcp://${serverName}/${uri}`
}

function parseResourceUri(formattedUri: string): { serverName: string; uri: string } | null {
  if (!formattedUri.startsWith('mcp://')) return null
  const remainder = formattedUri.slice('mcp://'.length)
  const firstSlash = remainder.indexOf('/')
  if (firstSlash < 1) return null
  return {
    serverName: remainder.slice(0, firstSlash),
    uri: remainder.slice(firstSlash + 1),
  }
}

function buildTransport(config: MCPServerConfig): AnyTransport {
  switch (config.type) {
    case 'stdio': {
      if (!config.command) {
        throw new Error(`MCP server '${config.name}': stdio transport requires 'command'.`)
      }
      return new StdioClientTransport({
        command: config.command,
        args: config.args ?? [],
        env: { ...process.env, ...(config.env ?? {}) } as Record<string, string>,
      })
    }
    case 'streamable-http': {
      if (!config.url) {
        throw new Error(`MCP server '${config.name}': streamable-http transport requires 'url'.`)
      }
      const headers: Record<string, string> = {}
      if (config.auth?.bearerToken) {
        headers['Authorization'] = `Bearer ${config.auth.bearerToken}`
      }
      if (config.auth?.apiKey) {
        headers[config.auth.headerName ?? 'X-API-Key'] = config.auth.apiKey
      }
      if (config.auth?.customHeaders) {
        Object.assign(headers, config.auth.customHeaders)
      }
      const init: ConstructorParameters<typeof StreamableHTTPClientTransport>[1] =
        Object.keys(headers).length > 0 ? { requestInit: { headers } } : undefined
      return new StreamableHTTPClientTransport(new URL(config.url), init)
    }
    default:
      throw new Error(`MCP server '${config.name}': unsupported transport type '${(config as any).type}'.`)
  }
}

async function getOrCreateMCPClient(serverName: string): Promise<Client> {
  const cached = clientCache.get(serverName)
  if (cached) return cached.client

  const existingPromise = clientPromises.get(serverName)
  if (existingPromise) return existingPromise

  const config = getMCPServer(serverName)
  if (!config) throw new Error(`MCP server '${serverName}' not found.`)
  if (!config.enabled) throw new Error(`MCP server '${serverName}' is disabled.`)

  const connectPromise = (async () => {
    const transport = buildTransport(config)
    const client = new Client({ name: 'gambit-agent', version: '1.0.0' })
    try {
      await client.connect(transport)
    } catch (error) {
      clientPromises.delete(serverName)
      throw error
    }
    clientCache.set(serverName, { client, transport })
    clientPromises.delete(serverName)
    return client
  })()

  clientPromises.set(serverName, connectPromise)
  return connectPromise
}

async function cleanupMCPClient(serverName: string): Promise<void> {
  discoveryCache.delete(serverName)
  const cached = clientCache.get(serverName)
  if (!cached) return
  clientCache.delete(serverName)
  try {
    await cached.client.close()
  } catch (error) {
    console.error(`Error closing MCP client for ${serverName}:`, error)
  }
}

export async function cleanupAllMCPClients(): Promise<void> {
  const names = Array.from(clientCache.keys())
  await Promise.allSettled(names.map((name) => cleanupMCPClient(name)))
}

function flattenCallToolResult(result: Awaited<ReturnType<Client['callTool']>>): string {
  const content = result.content ?? []
  if (content.length === 0) {
    return result.structuredContent ? JSON.stringify(result.structuredContent, null, 2) : ''
  }

  const parts = content.map((item) => {
    switch (item.type) {
      case 'text':
        return item.text
      case 'image':
        return `[image ${item.mimeType}] (${item.data.length} bytes base64)`
      case 'audio':
        return `[audio ${item.mimeType}] (${item.data.length} bytes base64)`
      case 'resource_link':
        return `[resource ${item.uri}] ${item.name}`
      case 'resource':
        return 'text' in item.resource ? item.resource.text : `[binary resource ${item.resource.uri}]`
      default:
        return JSON.stringify(item)
    }
  })

  const body = parts.join('\n')
  if (result.isError) {
    return `MCP tool reported an error:\n${body}`
  }
  return body
}

// --- Built-in meta tools for managing MCP servers ---

const listMCPResourcesSchema = z.object({
  serverName: z.string().describe('Configured enabled MCP server name from list-mcp-servers.'),
})

const listMCPResourcesTool: ToolDefinition<typeof listMCPResourcesSchema, string> = {
  id: 'list-mcp-resources',
  displayName: 'List MCP Resources',
  description:
    'List resource handles exposed by a configured MCP server. Returns mcp:// URIs to pass to read-mcp-resource.',
  inputSchema: listMCPResourcesSchema,
  execute: async ({ serverName }) => {
    const client = await getOrCreateMCPClient(serverName)
    const result = await client.listResources()
    const formatted = result.resources.map((resource) => ({
      uri: formatResourceUri(serverName, resource.uri),
      name: resource.name ?? resource.uri,
      description: resource.description ?? undefined,
      mimeType: resource.mimeType ?? undefined,
    }))
    return JSON.stringify(formatted, null, 2)
  },
}

const readMCPResourceSchema = z.object({
  uri: z.string().describe('MCP resource URI returned by list-mcp-resources (format: mcp://server-name/resource-path).'),
})

const readMCPResourceTool: ToolDefinition<typeof readMCPResourceSchema, string> = {
  id: 'read-mcp-resource',
  displayName: 'Read MCP Resource',
  description: 'Read the contents of a specific MCP resource URI returned by list-mcp-resources.',
  inputSchema: readMCPResourceSchema,
  execute: async ({ uri }) => {
    const parsed = parseResourceUri(uri)
    if (!parsed) {
      throw new Error('Invalid MCP resource URI. Expected format: mcp://server-name/resource-path')
    }
    const client = await getOrCreateMCPClient(parsed.serverName)
    const result = await client.readResource({ uri: parsed.uri })
    const parts = result.contents.map((content) => {
      if ('text' in content) return content.text
      return `Binary resource (base64): ${content.blob}`
    })
    return parts.join('\n')
  },
}

const listMCPToolsSchema = z.object({
  serverName: z.string().describe('Configured enabled MCP server name from list-mcp-servers.'),
})

const listMCPToolsTool: ToolDefinition<typeof listMCPToolsSchema, string> = {
  id: 'list-mcp-tools',
  displayName: 'List MCP Tools',
  description:
    'List raw tool names, namespaced IDs, descriptions, and input schemas exposed by a configured MCP server.',
  inputSchema: listMCPToolsSchema,
  execute: async ({ serverName }) => {
    const client = await getOrCreateMCPClient(serverName)
    const result = await client.listTools()
    const formatted = result.tools.map((tool) => ({
      name: tool.name,
      namespacedId: formatMCPToolId(serverName, tool.name),
      description: tool.description ?? undefined,
      inputSchema: tool.inputSchema,
    }))
    return JSON.stringify(formatted, null, 2)
  },
}

const callMCPToolSchema = z.object({
  serverName: z.string().describe('Configured enabled MCP server name from list-mcp-servers.'),
  toolName: z.string().describe('Raw MCP tool name from list-mcp-tools, not the namespaced ID.'),
  arguments: z.record(z.string(), z.unknown()).default({}).describe('Arguments matching the MCP tool input schema.'),
})

const callMCPToolTool: ToolDefinition<typeof callMCPToolSchema, string> = {
  id: 'call-mcp-tool',
  displayName: 'Call MCP Tool',
  description:
    'Fallback generic caller for a tool on a configured MCP server. Use after list-mcp-tools; when an auto-discovered mcp__server__tool is available, call that direct tool instead for better schema guidance.',
  inputSchema: callMCPToolSchema,
  execute: async ({ serverName, toolName, arguments: args }) => {
    const client = await getOrCreateMCPClient(serverName)
    const result = await client.callTool({ name: toolName, arguments: args })
    return flattenCallToolResult(result)
  },
}

const listMCPServersSchema = z.object({
  includeDisabled: z.boolean().optional().default(false).describe('Include disabled servers in the returned configuration list.'),
})

const listMCPServersTool: ToolDefinition<typeof listMCPServersSchema, string> = {
  id: 'list-mcp-servers',
  displayName: 'List MCP Servers',
  description: 'List configured MCP servers, optionally including disabled entries. Use when the server name is unknown.',
  inputSchema: listMCPServersSchema,
  execute: async ({ includeDisabled }) => {
    const servers = listMCPServerConfigs({ enabledOnly: !includeDisabled })
    const formatted = servers.map((config) => ({
      name: config.name,
      type: config.type,
      enabled: config.enabled,
      ...(config.type === 'stdio' ? { command: config.command, args: config.args ?? [] } : {}),
      ...(config.type === 'streamable-http' ? { url: config.url } : {}),
      hasAuth: Boolean(config.auth && Object.keys(config.auth).length > 0),
    }))
    return JSON.stringify(formatted, null, 2)
  },
}

const addMCPServerSchema = z.object({
  name: z.string().describe('Unique config name used by MCP resource and tool calls.'),
  type: z.enum(['stdio', 'streamable-http']).describe('Transport type.'),
  command: z.string().optional().describe('Executable command for stdio transport; required when type is stdio.'),
  args: z.array(z.string()).optional().describe('Command arguments for stdio transport.'),
  url: z.string().optional().describe('Server URL for streamable-http transport; required when type is streamable-http.'),
  env: z.record(z.string(), z.string()).optional().describe('Additional environment variables for stdio transport.'),
  bearerToken: z.string().optional().describe('Bearer token for streamable-http Authorization header.'),
  apiKey: z.string().optional().describe('API key value for streamable-http requests.'),
  apiKeyHeader: z.string().optional().describe('Header name for the API key. Defaults to X-API-Key.'),
  enabled: z.boolean().optional().default(true).describe('Whether the server is enabled after saving.'),
})

const addMCPServerTool: ToolDefinition<typeof addMCPServerSchema, string> = {
  id: 'add-mcp-server',
  displayName: 'Add MCP Server',
  description:
    'Add or replace an MCP server configuration. stdio requires command; streamable-http requires url. Use list-mcp-tools or list-mcp-resources after saving to verify.',
  inputSchema: addMCPServerSchema,
  execute: async (input) => {
    if (input.type === 'stdio' && !input.command) {
      throw new Error("stdio transport requires 'command'.")
    }
    if (input.type === 'streamable-http' && !input.url) {
      throw new Error("streamable-http transport requires 'url'.")
    }

    const auth: MCPServerConfig['auth'] = {}
    if (input.bearerToken) auth.bearerToken = input.bearerToken
    if (input.apiKey) {
      auth.apiKey = input.apiKey
      if (input.apiKeyHeader) auth.headerName = input.apiKeyHeader
    }

    const config: MCPServerConfig = {
      name: input.name,
      type: input.type,
      command: input.command,
      args: input.args,
      url: input.url,
      env: input.env,
      enabled: input.enabled ?? true,
    }
    if (Object.keys(auth).length > 0) config.auth = auth

    await cleanupMCPClient(input.name)
    addMCPServer(config)
    return `MCP server '${input.name}' saved.`
  },
  getPermissionRequest: ({ name, type, command, url }) => ({
    subject: `Add MCP server: ${name} (${type})`,
    metadata: { name, type, command, url },
  }),
}

const removeMCPServerSchema = z.object({
  name: z.string().describe('Configured MCP server name to remove.'),
})

const removeMCPServerTool: ToolDefinition<typeof removeMCPServerSchema, string> = {
  id: 'remove-mcp-server',
  displayName: 'Remove MCP Server',
  description: 'Remove an MCP server configuration and close any cached client connection.',
  inputSchema: removeMCPServerSchema,
  execute: async ({ name }) => {
    const server = getMCPServer(name)
    if (!server) throw new Error(`MCP server '${name}' not found.`)
    await cleanupMCPClient(name)
    removeMCPServer(name)
    return `MCP server '${name}' removed.`
  },
  getPermissionRequest: ({ name }) => ({
    subject: `Remove MCP server: ${name}`,
    metadata: { name },
  }),
}

const toggleMCPServerSchema = z.object({
  name: z.string().describe('Configured MCP server name to enable or disable.'),
  enabled: z.boolean().describe('true to enable the server, false to disable it.'),
})

const toggleMCPServerTool: ToolDefinition<typeof toggleMCPServerSchema, string> = {
  id: 'toggle-mcp-server',
  displayName: 'Toggle MCP Server',
  description: 'Enable or disable a configured MCP server and refresh its cached client connection.',
  inputSchema: toggleMCPServerSchema,
  execute: async ({ name, enabled }) => {
    const server = getMCPServer(name)
    if (!server) throw new Error(`MCP server '${name}' not found.`)
    await cleanupMCPClient(name)
    updateMCPServer(name, { enabled })
    return `MCP server '${name}' ${enabled ? 'enabled' : 'disabled'}.`
  },
}

export const mcpManagementTools: ToolDefinition<any, any>[] = [
  listMCPResourcesTool,
  readMCPResourceTool,
  listMCPToolsTool,
  callMCPToolTool,
  listMCPServersTool,
  addMCPServerTool,
  removeMCPServerTool,
  toggleMCPServerTool,
]

// --- Auto-discovered MCP tools ---

type MCPListToolsEntry = Awaited<ReturnType<Client['listTools']>>['tools'][number]

interface DiscoveredTool {
  serverName: string
  tool: MCPListToolsEntry
}

function buildZodSchemaForTool(tool: MCPListToolsEntry): ZodTypeAny {
  const jsonSchema = tool.inputSchema as { properties?: Record<string, unknown>; required?: string[] } | undefined
  const properties = jsonSchema?.properties
  if (!properties || Object.keys(properties).length === 0) {
    return z.record(z.string(), z.unknown()).describe('Arguments for this MCP tool.').default({})
  }

  const required = new Set(jsonSchema?.required ?? [])
  const shape: Record<string, ZodTypeAny> = {}
  for (const [key, raw] of Object.entries(properties)) {
    const field = raw as { description?: string }
    let fieldSchema: ZodTypeAny = z.unknown()
    if (field?.description) fieldSchema = fieldSchema.describe(field.description)
    if (!required.has(key)) fieldSchema = fieldSchema.optional()
    shape[key] = fieldSchema
  }
  return z.object(shape).passthrough()
}

function buildDiscoveredToolDefinition({ serverName, tool }: DiscoveredTool): ToolDefinition<any, any> {
  const id = formatMCPToolId(serverName, tool.name)
  const inputSchema = buildZodSchemaForTool(tool)
  const baseDescription = tool.description
    ? `[MCP ${serverName}] ${tool.description}`
    : `Call the '${tool.name}' tool on MCP server '${serverName}'.`
  const description = `${baseDescription} Auto-discovered MCP tool; pass only arguments defined by its input schema.`

  return {
    id,
    displayName: `${serverName}: ${tool.name}`,
    description,
    inputSchema,
    execute: async (input: unknown) => {
      const client = await getOrCreateMCPClient(serverName)
      const args = (input && typeof input === 'object' ? input : {}) as Record<string, unknown>
      const result = await client.callTool({ name: tool.name, arguments: args })
      return flattenCallToolResult(result)
    },
    getPermissionRequest: (input) => ({
      subject: `Call MCP tool ${serverName}:${tool.name}`,
      metadata: { serverName, toolName: tool.name, arguments: input },
    }),
  }
}

export async function discoverMCPTools(options: { timeoutMs?: number } = {}): Promise<ToolDefinition<any, any>[]> {
  const timeoutMs = options.timeoutMs ?? 5000
  const servers = Object.values(listEnabledMCPServers())
  if (servers.length === 0) return []

  const now = Date.now()
  const results = await Promise.allSettled(
    servers.map(async (server): Promise<ToolDefinition<any, any>[]> => {
      const cached = discoveryCache.get(server.name)
      if (cached?.tools) return cached.tools
      if (cached?.failureExpiresAt && cached.failureExpiresAt > now) {
        throw new Error(`MCP server '${server.name}' is in failure cooldown.`)
      }

      try {
        const client = await withTimeout(getOrCreateMCPClient(server.name), timeoutMs, `connect to MCP server '${server.name}'`)
        const listing = await withTimeout(client.listTools(), timeoutMs, `list tools for MCP server '${server.name}'`)
        const tools = listing.tools.map((tool) => buildDiscoveredToolDefinition({ serverName: server.name, tool }))
        discoveryCache.set(server.name, { tools })
        return tools
      } catch (error) {
        discoveryCache.set(server.name, { failureExpiresAt: now + DISCOVERY_FAILURE_TTL_MS })
        throw error
      }
    }),
  )

  const discovered: ToolDefinition<any, any>[] = []
  for (const [index, result] of results.entries()) {
    if (result.status === 'fulfilled') {
      discovered.push(...result.value)
    } else {
      console.warn(`Failed to discover MCP tools for '${servers[index]?.name}':`, result.reason)
    }
  }
  return discovered
}

async function withTimeout<T>(promise: Promise<T>, ms: number, description: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined
  const timeoutPromise = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`Timed out after ${ms}ms while trying to ${description}.`)), ms)
  })
  try {
    return await Promise.race([promise, timeoutPromise])
  } finally {
    if (timer) clearTimeout(timer)
  }
}
