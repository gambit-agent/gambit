import { randomUUID } from 'node:crypto'

import { defaultModel } from '../config'
import { readModelSelection } from '../session/model-selection'
import { cleanupAllMCPClients } from '../tools/mcp'
import { bootstrapAppRuntime } from './bootstrap'

export interface RunHeadlessOptions {
  message: string
  stdout?: NodeJS.WriteStream
  stderr?: NodeJS.WriteStream
}

export async function runHeadless(options: RunHeadlessOptions): Promise<number> {
  const stdout = options.stdout ?? process.stdout
  const stderr = options.stderr ?? process.stderr

  const apiKey = Bun.env.OPENROUTER_API_KEY?.trim()
  if (!apiKey) {
    stderr.write('Error: OPENROUTER_API_KEY environment variable is required for -m mode.\n')
    return 1
  }

  const trimmedMessage = options.message.trim()
  if (!trimmedMessage) {
    stderr.write('Error: --message/-m requires a non-empty prompt.\n')
    return 1
  }

  const runtime = await bootstrapAppRuntime()
  runtime.permissionEngine.setMode('auto-accept')

  const selection = await readModelSelection().catch(() => null)
  const modelId = selection?.modelId ?? defaultModel
  const reasoningEffort = selection?.reasoningEffort ?? null

  const printed = new Map<string, number>()

  const unsubscribe = runtime.conversationStore.subscribe(() => {
    const snapshot = runtime.conversationStore.getSnapshot()
    for (const message of snapshot.messages) {
      if (message.hidden) continue
      const alreadyPrinted = printed.get(message.id) ?? 0

      if (message.role === 'assistant') {
        if (message.content.length > alreadyPrinted) {
          stdout.write(message.content.slice(alreadyPrinted))
          printed.set(message.id, message.content.length)
        }
        continue
      }

      if (message.role === 'tool') {
        if (alreadyPrinted > 0) continue
        const name = message.metadata?.toolName ?? 'tool'
        const status = message.metadata?.toolStatus ?? 'started'
        stderr.write(`\n[${name}:${status}]\n`)
        printed.set(message.id, 1)
      }
    }
  })

  const controller = new AbortController()
  const onSignal = () => controller.abort()
  process.on('SIGINT', onSignal)
  process.on('SIGTERM', onSignal)

  let exitCode = 0
  try {
    await runtime.resetConversation()
    await runtime.conversationStore.pushMessage({
      id: randomUUID(),
      role: 'user',
      content: trimmedMessage,
      timestamp: new Date().toISOString(),
    })

    await runtime.conversationRunner.runTurn({
      userInput: trimmedMessage,
      apiKey,
      modelId,
      reasoningEffort,
      signal: controller.signal,
    })

    stdout.write('\n')
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error)
    stderr.write(`\nError: ${errorMessage}\n`)
    exitCode = 1
  } finally {
    process.off('SIGINT', onSignal)
    process.off('SIGTERM', onSignal)
    unsubscribe()
    await Promise.race([
      cleanupAllMCPClients(),
      new Promise((resolve) => setTimeout(resolve, 2000)),
    ]).catch(() => undefined)
  }

  return exitCode
}
