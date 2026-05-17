import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import path from 'node:path'
import { z } from 'zod'

const CONFIG_DIR_NAME = '.gambit'
const CONFIG_FILE_NAME = 'mcp-servers.json'

export type MCPTransportType = 'stdio' | 'streamable-http'

export interface MCPServerAuth {
  bearerToken?: string
  apiKey?: string
  headerName?: string
  customHeaders?: Record<string, string>
}

export interface MCPServerConfig {
  name: string
  type: MCPTransportType
  command?: string
  args?: string[]
  url?: string
  env?: Record<string, string>
  auth?: MCPServerAuth
  enabled: boolean
}

const MCPServerAuthSchema = z
  .object({
    bearerToken: z.string().optional(),
    apiKey: z.string().optional(),
    headerName: z.string().optional(),
    customHeaders: z.record(z.string(), z.string()).optional(),
  })
  .optional()

const MCPServerConfigSchema = z.object({
  name: z.string(),
  type: z.enum(['stdio', 'streamable-http']),
  command: z.string().optional(),
  args: z.array(z.string()).optional(),
  url: z.string().optional(),
  env: z.record(z.string(), z.string()).optional(),
  auth: MCPServerAuthSchema,
  enabled: z.boolean().default(true),
})

const MCPConfigSchema = z.object({
  servers: z.record(z.string(), MCPServerConfigSchema),
})

export type MCPConfig = z.infer<typeof MCPConfigSchema>

let configPathOverride: string | undefined

export function setMCPConfigPathOverride(overridePath: string | undefined): void {
  configPathOverride = overridePath ? path.resolve(overridePath) : undefined
}

export function getConfigDir(): string {
  return path.join(homedir(), CONFIG_DIR_NAME)
}

export function getConfigPath(): string {
  return configPathOverride ?? path.join(getConfigDir(), CONFIG_FILE_NAME)
}

export function loadMCPConfig(): MCPConfig {
  const configPath = getConfigPath()

  if (!existsSync(configPath)) {
    return { servers: {} }
  }

  try {
    const content = readFileSync(configPath, 'utf-8')
    const parsed = JSON.parse(content)
    return MCPConfigSchema.parse(parsed)
  } catch (error) {
    console.warn(`Failed to load MCP config from ${configPath}:`, error)
    return { servers: {} }
  }
}

export function saveMCPConfig(config: MCPConfig): void {
  const configPath = getConfigPath()
  mkdirSync(path.dirname(configPath), { recursive: true })
  writeFileSync(configPath, JSON.stringify(config, null, 2), 'utf-8')
}

export function addMCPServer(server: MCPServerConfig): void {
  const config = loadMCPConfig()
  config.servers[server.name] = server
  saveMCPConfig(config)
}

export function removeMCPServer(name: string): void {
  const config = loadMCPConfig()
  delete config.servers[name]
  saveMCPConfig(config)
}

export function updateMCPServer(name: string, updates: Partial<MCPServerConfig>): void {
  const config = loadMCPConfig()
  if (config.servers[name]) {
    config.servers[name] = { ...config.servers[name], ...updates }
    saveMCPConfig(config)
  }
}

export function getMCPServer(name: string): MCPServerConfig | undefined {
  const config = loadMCPConfig()
  return config.servers[name]
}

export function listMCPServerConfigs(options: { enabledOnly?: boolean } = {}): MCPServerConfig[] {
  const config = loadMCPConfig()
  const servers = Object.values(config.servers)
  return options.enabledOnly ? servers.filter((s) => s.enabled) : servers
}

export function listEnabledMCPServers(): Record<string, MCPServerConfig> {
  const config = loadMCPConfig()
  return Object.fromEntries(Object.entries(config.servers).filter(([, server]) => server.enabled))
}
