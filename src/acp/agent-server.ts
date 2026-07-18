import { stat } from 'node:fs/promises'
import path from 'node:path'
import { Readable, Writable } from 'node:stream'

import * as acp from '@agentclientprotocol/sdk'
import type {
  AgentContext,
  AgentApp,
  AvailableCommand,
  SessionConfigSelectOption,
} from '@agentclientprotocol/sdk'

import { bootstrapAppRuntime, type AppRuntime, type BootstrapAppRuntimeOptions } from '../app/bootstrap'
import { prepareHeadlessInput } from '../app/headless-runner'
import { appVersion } from '../app/version'
import { defaultModel, setWorkspaceRoot } from '../config'
import { generateId } from '../lib/id'
import type { ImageAttachment } from '../lib/image-attachments'
import { buildFallbackModels, fetchAvailableModels } from '../lib/modelPicker'
import { getProviderCredential } from '../lib/provider-credentials'
import { isReasoningEffort, type ReasoningEffort } from '../lib/model'
import type { ModelListItem } from '../lib/openrouterModels'
import type { PermissionEvaluationInput, PermissionMode } from '../permissions/permission-rules'
import { loadSlashCommands } from '../lib/slashCommands'
import { builtInSlashCommands } from '../repl/slash-completions'
import { readModelSelection, writeModelSelection } from '../session/model-selection'
import { listConversationSessions } from '../session/conversation-sessions'
import { cleanupAllMCPClients } from '../tools/mcp'
import { buildSessionConfigOptions, getToolKind, mapStopReason, promptBlocksToInput } from './protocol-mapper'
import { AcpTurnBridge } from './turn-bridge'

type RuntimeFactory = (options: BootstrapAppRuntimeOptions) => Promise<AppRuntime>
type ModelCatalogLoader = (apiKey: string | null) => Promise<ModelListItem[]>

interface AcpSession {
  sessionId: string
  cwd: string
  runtime: AppRuntime
  modelId: string | null
  reasoningEffort: ReasoningEffort | null
  providerSlug: string | null
  models: ModelListItem[]
  client: AgentContext
  controller: AbortController | null
  bridge: AcpTurnBridge | null
}

export interface CreateAcpAgentOptions {
  runtimeFactory?: RuntimeFactory
  modelCatalogLoader?: ModelCatalogLoader
}

export class GambitAcpAgent {
  private readonly sessions = new Map<string, AcpSession>()
  private readonly runtimeFactory: RuntimeFactory
  private readonly modelCatalogLoader: ModelCatalogLoader
  private workspaceRoot: string | null = null

  constructor(options: CreateAcpAgentOptions = {}) {
    this.runtimeFactory = options.runtimeFactory ?? bootstrapAppRuntime
    this.modelCatalogLoader = options.modelCatalogLoader ?? fetchAvailableModels
  }

  createApp(): AgentApp {
    return acp.agent({ name: 'gambit' })
      .onRequest(acp.methods.agent.initialize, ({ params }) => ({
        protocolVersion: acp.PROTOCOL_VERSION,
        agentCapabilities: {
          promptCapabilities: { image: true },
          sessionCapabilities: {
            list: {},
            resume: {},
            close: {},
          },
        },
        agentInfo: {
          name: 'Gambit',
          version: appVersion,
        },
      }))
      .onRequest(acp.methods.agent.session.new, async ({ params, client }) => {
        const cwd = await this.bindWorkspace(params.cwd)
        this.assertSessionExtensionsSupported(params.additionalDirectories, params.mcpServers)
        const session = await this.createSession(cwd, client)
        this.scheduleSessionFeatures(session)
        return {
          sessionId: session.sessionId,
          configOptions: this.getConfigOptions(session),
        }
      })
      .onRequest(acp.methods.agent.session.list, async ({ params }) => {
        if (params.cursor) {
          throw acp.RequestError.invalidParams(params.cursor, 'Gambit does not paginate ACP sessions.')
        }
        const cwd = await this.bindWorkspace(params.cwd ?? this.workspaceRoot ?? process.cwd())
        const persistedSessions = await listConversationSessions(cwd)
        const sessions = new Map(persistedSessions.map((session) => [session.conversationId, {
          sessionId: session.conversationId,
          cwd,
          title: session.title,
          updatedAt: session.updatedAt,
        }]))
        for (const session of this.sessions.values()) {
          if (pathsEqual(session.cwd, cwd) && !sessions.has(session.sessionId)) {
            sessions.set(session.sessionId, {
              sessionId: session.sessionId,
              cwd,
              title: `Session ${session.sessionId.slice(0, 8)}`,
              updatedAt: null,
            })
          }
        }
        return {
          sessions: Array.from(sessions.values()),
        }
      })
      .onRequest(acp.methods.agent.session.resume, async ({ params, client }) => {
        const cwd = await this.bindWorkspace(params.cwd)
        this.assertSessionExtensionsSupported(params.additionalDirectories, params.mcpServers)
        const existing = this.sessions.get(params.sessionId)
        const session = existing ?? await this.resumeSession(params.sessionId, cwd, client)
        session.client = client
        this.scheduleSessionFeatures(session)
        return { configOptions: this.getConfigOptions(session) }
      })
      .onRequest(acp.methods.agent.session.close, async ({ params }) => {
        const session = this.getSession(params.sessionId)
        session.controller?.abort()
        await session.bridge?.flush()
        session.bridge?.stop()
        this.sessions.delete(params.sessionId)
        return {}
      })
      .onRequest(acp.methods.agent.session.setConfigOption, async ({ params }) => {
        const session = this.getSession(params.sessionId)
        if (typeof params.value !== 'string') {
          throw acp.RequestError.invalidParams(params, 'Gambit ACP configuration values must be selections.')
        }
        if (params.configId === 'model') {
          await this.selectModel(session, params.value)
        } else if (params.configId === 'permission-mode') {
          if (!isPermissionMode(params.value)) {
            throw acp.RequestError.invalidParams(params.value, 'Unknown Gambit permission mode.')
          }
          session.runtime.permissionEngine.setMode(params.value)
        } else if (params.configId === 'reasoning-effort') {
          if (params.value !== 'default' && !isReasoningEffort(params.value)) {
            throw acp.RequestError.invalidParams(params.value, 'Unknown reasoning effort.')
          }
          session.reasoningEffort = params.value === 'default' ? null : params.value
        } else {
          throw acp.RequestError.invalidParams(params.configId, 'Unknown Gambit configuration option.')
        }
        return { configOptions: this.getConfigOptions(session) }
      })
      .onRequest(acp.methods.agent.session.prompt, async ({ params, client, signal }) => {
        const session = this.getSession(params.sessionId)
        if (session.controller) {
          throw acp.RequestError.invalidParams(params.sessionId, 'A prompt is already running for this session.')
        }
        let userInput: string
        let attachments: ImageAttachment[]
        try {
          const input = promptBlocksToInput(params.prompt)
          userInput = input.text
          attachments = input.attachments
        } catch (error) {
          throw acp.RequestError.invalidParams(params.prompt, getErrorMessage(error))
        }
        if (!userInput && attachments.length === 0) {
          throw acp.RequestError.invalidParams(params.prompt, 'The prompt must contain text, a resource link, or an image.')
        }

        session.client = client
        let hiddenContext: string | undefined
        const slashCommand = parseSlashCommand(userInput)
        if (slashCommand?.name.toLowerCase() === 'model') {
          return this.handleModelCommand(session, slashCommand.argument)
        }
        if (slashCommand) {
          const prepared = await this.prepareSlashCommand(session, slashCommand)
          if (prepared.kind === 'local') {
            await this.notifyAgentMessage(session, prepared.output)
            return { stopReason: 'end_turn' }
          }
          userInput = prepared.prompt
          hiddenContext = prepared.hiddenContext
        }
        if (!session.modelId) {
          throw acp.RequestError.invalidParams(
            params.sessionId,
            'No model selected. Use the ACP model selector or /model <model-id>.',
          )
        }

        const controller = new AbortController()
        const abort = () => controller.abort()
        signal.addEventListener('abort', abort, { once: true })
        session.controller = controller
        const bridge = new AcpTurnBridge(
          session.runtime.conversationStore,
          session.sessionId,
          session.cwd,
          (notification) => client.notify(acp.methods.client.session.update, notification),
        )
        session.bridge = bridge
        bridge.start()

        try {
          if (hiddenContext?.trim()) {
            await session.runtime.conversationStore.pushMessage({
              id: generateId(),
              role: 'user',
              content: hiddenContext,
              hidden: true,
              timestamp: new Date().toISOString(),
            })
          }
          await session.runtime.conversationStore.pushMessage({
            id: generateId(),
            role: 'user',
            content: userInput,
            metadata: attachments.length > 0 ? { attachments } : undefined,
            timestamp: new Date().toISOString(),
          })
          const turn = await session.runtime.conversationRunner.runTurn({
            userInput,
            apiKey: getProviderCredential('openrouter')?.apiKey ?? '',
            modelId: session.modelId,
            reasoningEffort: session.reasoningEffort,
            providerSlug: session.providerSlug,
            showReasoning: false,
            signal: controller.signal,
            disabledToolIds: ['askUserQuestion'],
          })
          await bridge.flush()
          return { stopReason: mapStopReason(turn) }
        } catch (error) {
          if (controller.signal.aborted) {
            await bridge.flush().catch(() => undefined)
            return { stopReason: 'cancelled' }
          }
          throw error
        } finally {
          signal.removeEventListener('abort', abort)
          await bridge.flush().catch(() => undefined)
          bridge.stop()
          session.bridge = null
          session.controller = null
        }
      })
      .onNotification(acp.methods.agent.session.cancel, async ({ params }) => {
        const session = this.sessions.get(params.sessionId)
        session?.controller?.abort()
        await session?.bridge?.flush()
      })
  }

  private async createSession(cwd: string, client: AgentContext): Promise<AcpSession> {
    let session: AcpSession | null = null
    const runtime = await this.runtimeFactory({
      rootPath: cwd,
      permissionRequestHandler: (input) => this.requestPermission(session, input),
      disabledToolIds: ['askUserQuestion'],
    })
    const selection = await readModelSelection(cwd).catch(() => null)
    session = {
      sessionId: runtime.conversationStore.getSnapshot().conversationId,
      cwd,
      runtime,
      modelId: selection?.modelId ?? defaultModel,
      reasoningEffort: selection?.reasoningEffort ?? null,
      providerSlug: selection?.providerSlug ?? null,
      models: ensureCurrentModel(buildFallbackModels(), selection?.modelId ?? defaultModel),
      client,
      controller: null,
      bridge: null,
    }
    this.sessions.set(session.sessionId, session)
    return session
  }

  private async resumeSession(sessionId: string, cwd: string, client: AgentContext): Promise<AcpSession> {
    let session: AcpSession | null = null
    const runtime = await this.runtimeFactory({
      rootPath: cwd,
      deferConversationInitialization: true,
      permissionRequestHandler: (input) => this.requestPermission(session, input),
      disabledToolIds: ['askUserQuestion'],
    })
    try {
      await runtime.resumeConversation(sessionId)
    } catch {
      throw acp.RequestError.resourceNotFound(sessionId)
    }
    const selection = await readModelSelection(cwd).catch(() => null)
    session = {
      sessionId,
      cwd,
      runtime,
      modelId: selection?.modelId ?? defaultModel,
      reasoningEffort: selection?.reasoningEffort ?? null,
      providerSlug: selection?.providerSlug ?? null,
      models: ensureCurrentModel(buildFallbackModels(), selection?.modelId ?? defaultModel),
      client,
      controller: null,
      bridge: null,
    }
    this.sessions.set(sessionId, session)
    return session
  }

  private async requestPermission(
    session: AcpSession | null,
    input: PermissionEvaluationInput,
  ): Promise<'allow' | 'deny'> {
    if (!session) return 'deny'
    await session.bridge?.flush()
    const toolCallId = typeof input.metadata?.toolCallId === 'string'
      ? input.metadata.toolCallId
      : generateId()
    const response = await session.client.request(acp.methods.client.session.requestPermission, {
      sessionId: session.sessionId,
      toolCall: {
        toolCallId,
        title: input.subject,
        kind: getToolKind(input.toolId),
        status: 'in_progress',
        rawInput: input.metadata?.input,
      },
      options: [
        { optionId: 'allow-once', name: 'Allow once', kind: 'allow_once' },
        { optionId: 'reject-once', name: 'Reject once', kind: 'reject_once' },
      ],
    }, { cancellationSignal: session.controller?.signal })
    return response.outcome.outcome === 'selected' && response.outcome.optionId === 'allow-once'
      ? 'allow'
      : 'deny'
  }

  private getSession(sessionId: string): AcpSession {
    const session = this.sessions.get(sessionId)
    if (!session) throw acp.RequestError.resourceNotFound(sessionId)
    return session
  }

  private getConfigOptions(session: AcpSession) {
    return buildSessionConfigOptions(
      session.runtime.permissionEngine.getSnapshot().mode,
      session.modelId,
      session.models.map(modelToConfigOption),
      session.reasoningEffort,
    )
  }

  private scheduleSessionFeatures(session: AcpSession): void {
    setTimeout(() => {
      void this.publishSessionFeatures(session)
    }, 0)
  }

  private async publishSessionFeatures(session: AcpSession): Promise<void> {
    if (!this.sessions.has(session.sessionId)) return
    const availableCommands = await this.getAvailableCommands()
    if (!this.sessions.has(session.sessionId)) return
    await this.notifySession(session, {
      sessionUpdate: 'available_commands_update',
      availableCommands,
    }).catch(() => undefined)

    const models = await this.modelCatalogLoader(
      getProviderCredential('openrouter')?.apiKey ?? null,
    ).catch(() => session.models)
    if (!this.sessions.has(session.sessionId)) return
    session.models = ensureCurrentModel(models, session.modelId)
    await this.notifyConfigOptions(session).catch(() => undefined)
  }

  private async selectModel(session: AcpSession, modelId: string): Promise<void> {
    if (modelId === '__gambit_no_model__' || !session.models.some((model) => model.id === modelId)) {
      throw acp.RequestError.invalidParams(modelId, 'Unknown Gambit model.')
    }
    session.modelId = modelId
    session.providerSlug = null
    await writeModelSelection({
      modelId,
      reasoningEffort: session.reasoningEffort,
      providerSlug: null,
    }, session.cwd)
  }

  private async handleModelCommand(
    session: AcpSession,
    input: string,
  ): Promise<{ stopReason: 'end_turn' }> {
    const query = input.trim()
    let message: string
    if (!query) {
      message = session.modelId
        ? `Current model: ${session.modelId}. Use Zed's model selector or /model <model-id> to change it.`
        : 'No model is selected. Use Zed\'s model selector or /model <model-id> to choose one.'
    } else {
      const exact = session.models.find((model) => model.id === query)
        ?? session.models.find((model) => model.id.toLowerCase() === query.toLowerCase())
      if (exact) {
        await this.selectModel(session, exact.id)
        await this.notifyConfigOptions(session)
        message = `Model set to ${exact.id}.`
      } else {
        const matches = session.models.filter((model) =>
          `${model.id} ${model.name}`.toLowerCase().includes(query.toLowerCase()),
        ).slice(0, 10)
        message = matches.length > 0
          ? `No exact model matched "${query}". Matching models:\n${matches.map((model) => `- ${model.id}`).join('\n')}`
          : `Unknown model "${query}". Use Zed's model selector to see available models.`
      }
    }

    await this.notifyAgentMessage(session, message)
    return { stopReason: 'end_turn' }
  }

  private async prepareSlashCommand(
    session: AcpSession,
    command: ParsedSlashCommand,
  ): ReturnType<typeof prepareHeadlessInput> {
    const builtInName = command.name.toLowerCase()
    if (builtInName === 'help') {
      const commands = await this.getAvailableCommands()
      return {
        kind: 'local',
        output: [
          'Available commands',
          '',
          ...commands.map((available) => {
            const hint = available.input?.hint ? ` ${available.input.hint}` : ''
            return `- /${available.name}${hint} — ${available.description}`
          }),
        ].join('\n'),
      }
    }

    if (builtInName === 'clear' || builtInName === 'reset') {
      await session.runtime.conversationStore.replaceMessages([])
      return { kind: 'local', output: 'Cleared the current ACP conversation.' }
    }

    const clientOwnedMessages: Record<string, string> = {
      connect: 'Provider connection setup is not available over ACP yet. Run /connect in the Gambit TUI, then restart the ACP session.',
      resume: 'Use Zed\'s agent thread history to resume a Gambit ACP session.',
      themes: 'The editor controls themes for ACP sessions.',
      mcp: 'MCP servers configured in Gambit are active in ACP. Use the Gambit TUI to manage server connections.',
      fork: 'Start a new Zed agent thread to fork work without changing this ACP session\'s identity.',
    }
    const clientOwnedMessage = clientOwnedMessages[builtInName]
    if (clientOwnedMessage) {
      return { kind: 'local', output: clientOwnedMessage }
    }

    return prepareHeadlessInput(session.runtime, command.raw)
  }

  private async getAvailableCommands(): Promise<AvailableCommand[]> {
    const customCommands = await loadSlashCommands().catch(() => [])
    const commands: AvailableCommand[] = [
      ...builtInSlashCommands.map((command) => ({
        name: command.name,
        description: command.description,
        ...(command.argumentHint ? { input: { hint: command.argumentHint } } : {}),
      })),
      ...customCommands.map((command) => ({
        name: command.id,
        description: command.description ?? `Run ${command.relativePath}.`,
        ...(command.argumentHint ? { input: { hint: command.argumentHint } } : {}),
      })),
    ]
    return Array.from(new Map(commands.map((command) => [command.name, command])).values())
  }

  private notifyAgentMessage(session: AcpSession, text: string): Promise<void> {
    return this.notifySession(session, {
      sessionUpdate: 'agent_message_chunk',
      messageId: generateId(),
      content: { type: 'text', text },
    })
  }

  private notifyConfigOptions(session: AcpSession): Promise<void> {
    return this.notifySession(session, {
      sessionUpdate: 'config_option_update',
      configOptions: this.getConfigOptions(session),
    })
  }

  private notifySession(session: AcpSession, update: acp.SessionUpdate): Promise<void> {
    return session.client.notify(acp.methods.client.session.update, {
      sessionId: session.sessionId,
      update,
    })
  }

  private assertSessionExtensionsSupported(
    additionalDirectories?: readonly string[],
    mcpServers?: readonly unknown[],
  ): void {
    if (additionalDirectories?.length) {
      throw acp.RequestError.invalidParams(
        additionalDirectories,
        'Gambit ACP does not yet support additional workspace directories.',
      )
    }
    if (mcpServers?.length) {
      throw acp.RequestError.invalidParams(
        mcpServers,
        'Gambit ACP does not yet accept client-provided MCP servers.',
      )
    }
  }

  private async bindWorkspace(requestedRoot: string): Promise<string> {
    if (!path.isAbsolute(requestedRoot)) {
      throw acp.RequestError.invalidParams(requestedRoot, 'ACP workspace paths must be absolute.')
    }
    const root = path.resolve(requestedRoot)
    const info = await stat(root).catch(() => null)
    if (!info?.isDirectory()) {
      throw acp.RequestError.invalidParams(requestedRoot, 'ACP workspace path is not a directory.')
    }
    if (this.workspaceRoot && !pathsEqual(this.workspaceRoot, root)) {
      throw acp.RequestError.invalidParams(
        requestedRoot,
        `This Gambit ACP process is already bound to ${this.workspaceRoot}.`,
      )
    }
    if (!this.workspaceRoot) {
      this.workspaceRoot = root
      setWorkspaceRoot(root)
    }
    return root
  }
}

export function createAcpAgentApp(options: CreateAcpAgentOptions = {}): AgentApp {
  return new GambitAcpAgent(options).createApp()
}

export async function runAcpAgent(): Promise<void> {
  const output = Writable.toWeb(process.stdout) as WritableStream<Uint8Array>
  const input = Readable.toWeb(process.stdin) as unknown as ReadableStream<Uint8Array>
  const connection = createAcpAgentApp().connect(acp.ndJsonStream(output, input))
  const close = () => connection.close()
  process.on('SIGINT', close)
  process.on('SIGTERM', close)
  try {
    await connection.closed
  } finally {
    process.off('SIGINT', close)
    process.off('SIGTERM', close)
    await cleanupAllMCPClients().catch(() => undefined)
  }
}

function isPermissionMode(value: string): value is PermissionMode {
  return value === 'Normal' || value === 'Plan' || value === 'Auto-accept'
}

function pathsEqual(left: string, right: string): boolean {
  return process.platform === 'win32'
    ? left.toLowerCase() === right.toLowerCase()
    : left === right
}

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

interface ParsedSlashCommand {
  name: string
  argument: string
  raw: string
}

function parseSlashCommand(input: string): ParsedSlashCommand | null {
  const match = input.match(/^\/([^\s]+)(?:\s+([\s\S]*))?\s*$/)
  if (!match?.[1]) return null
  return {
    name: match[1],
    argument: match[2]?.trim() ?? '',
    raw: input.trim(),
  }
}

function ensureCurrentModel(models: readonly ModelListItem[], modelId: string | null): ModelListItem[] {
  const deduplicated = Array.from(new Map(models.map((model) => [model.id, model])).values())
  if (!modelId || deduplicated.some((model) => model.id === modelId)) return deduplicated
  return [{
    id: modelId,
    name: modelId,
    description: null,
    provider: modelId.includes('/') ? modelId.split('/')[0] ?? null : null,
    promptPrice: null,
    completionPrice: null,
    requestPrice: null,
    supportsReasoning: false,
    reasoningEfforts: null,
    defaultReasoningEffort: null,
  }, ...deduplicated]
}

function modelToConfigOption(model: ModelListItem): SessionConfigSelectOption {
  return {
    value: model.id,
    name: model.name,
    description: model.description
      ? `${model.id} — ${model.description}`
      : model.id,
  }
}
