import { homedir } from 'node:os'
import path from 'node:path'
import { pathToFileURL } from 'node:url'

import { workspaceRoot } from '../config'
import { collectFiles } from '../lib/file-scanner'

export type GambitHookEvent = {
  type: string
  timestamp: string
  sessionID?: string
  data?: Record<string, unknown>
}

export interface GambitPluginContext {
  directory: string
  workspaceRoot: string
  project: {
    directory: string
  }
  $: typeof Bun.$
}

export interface GambitHookMap {
  event?: (input: { event: GambitHookEvent }) => Promise<void> | void
  'command.execute.before'?: (
    input: { command: string; sessionID?: string; arguments: string },
    output: { content: string },
  ) => Promise<void> | void
  'command.execute.after'?: (
    input: { command: string; sessionID?: string; arguments: string },
    output: { content?: string },
  ) => Promise<void> | void
  'tool.execute.before'?: (
    input: { tool: string; sessionID?: string; callID: string },
    output: { args: unknown },
  ) => Promise<void> | void
  'tool.execute.after'?: (
    input: { tool: string; sessionID?: string; callID: string; args: unknown },
    output: { output: unknown; summary?: string; metadata?: Record<string, unknown> },
  ) => Promise<void> | void
}

export type GambitPlugin = (context: GambitPluginContext) => Promise<GambitHookMap | void> | GambitHookMap | void

export interface LoadedGambitPlugin {
  filePath: string
  hooks: GambitHookMap
}

export interface HookManagerOptions {
  root?: string
  userHome?: string
  pluginDirectories?: string[]
  importSuffix?: string
}

const PLUGIN_EXTENSIONS = new Set(['.js', '.mjs', '.ts'])

export class HookManager {
  private readonly plugins: LoadedGambitPlugin[]

  private constructor(plugins: LoadedGambitPlugin[]) {
    this.plugins = plugins
  }

  static fromHooks(plugins: LoadedGambitPlugin[]): HookManager {
    return new HookManager(plugins)
  }

  static async load(options: HookManagerOptions = {}): Promise<HookManager> {
    const root = options.root ?? workspaceRoot
    const userHome = options.userHome ?? homedir()
    const directories = options.pluginDirectories ?? [
      path.join(root, '.gambit', 'plugins'),
      path.join(root, '.opencode', 'plugins'),
      path.join(userHome, '.gambit', 'plugins'),
    ]

    const plugins: LoadedGambitPlugin[] = []
    for (const directory of directories) {
      const files = await collectFiles(directory, { extensions: PLUGIN_EXTENSIONS })
      for (const filePath of files) {
        const hooks = await loadPlugin(filePath, root, options.importSuffix)
        if (hooks) {
          plugins.push({ filePath, hooks })
        }
      }
    }

    return new HookManager(plugins)
  }

  list(): LoadedGambitPlugin[] {
    return [...this.plugins]
  }

  async emit(event: Omit<GambitHookEvent, 'timestamp'> & { timestamp?: string }): Promise<void> {
    const payload: GambitHookEvent = {
      ...event,
      timestamp: event.timestamp ?? new Date().toISOString(),
    }

    for (const plugin of this.plugins) {
      await plugin.hooks.event?.({ event: payload })
    }
  }

  async runCommandBefore(input: { command: string; sessionID?: string; arguments: string; content: string }): Promise<string> {
    const output = { content: input.content }
    for (const plugin of this.plugins) {
      await plugin.hooks['command.execute.before']?.(
        { command: input.command, sessionID: input.sessionID, arguments: input.arguments },
        output,
      )
    }
    return output.content
  }

  async runCommandAfter(input: { command: string; sessionID?: string; arguments: string; content?: string }): Promise<string | undefined> {
    const output = { content: input.content }
    for (const plugin of this.plugins) {
      await plugin.hooks['command.execute.after']?.(
        { command: input.command, sessionID: input.sessionID, arguments: input.arguments },
        output,
      )
    }
    return output.content
  }

  async runToolBefore(input: { tool: string; sessionID?: string; callID: string; args: unknown }): Promise<unknown> {
    const output = { args: input.args }
    for (const plugin of this.plugins) {
      await plugin.hooks['tool.execute.before']?.(
        { tool: input.tool, sessionID: input.sessionID, callID: input.callID },
        output,
      )
    }
    return output.args
  }

  async runToolAfter(input: {
    tool: string
    sessionID?: string
    callID: string
    args: unknown
    output: unknown
    summary?: string
    metadata?: Record<string, unknown>
  }): Promise<{ output: unknown; summary?: string; metadata?: Record<string, unknown> }> {
    const hookOutput = {
      output: input.output,
      summary: input.summary,
      metadata: input.metadata,
    }
    for (const plugin of this.plugins) {
      await plugin.hooks['tool.execute.after']?.(
        { tool: input.tool, sessionID: input.sessionID, callID: input.callID, args: input.args },
        hookOutput,
      )
    }
    return hookOutput
  }
}

async function loadPlugin(filePath: string, root: string, importSuffix: string | undefined): Promise<GambitHookMap | null> {
  const url = pathToFileURL(filePath)
  if (importSuffix) {
    url.searchParams.set('v', importSuffix)
  }

  const module = await import(url.href)
  const plugin = module.default ?? module.Plugin ?? module.plugin
  const context: GambitPluginContext = {
    directory: path.dirname(filePath),
    workspaceRoot: root,
    project: { directory: root },
    $: Bun.$,
  }

  const hooks = typeof plugin === 'function' ? await (plugin as GambitPlugin)(context) : plugin
  if (!hooks || typeof hooks !== 'object') {
    return null
  }
  return hooks as GambitHookMap
}
