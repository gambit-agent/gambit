import { afterEach, describe, expect, test } from 'bun:test'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

import * as acp from '@agentclientprotocol/sdk'

import { setWorkspaceRootForTesting, workspaceRoot } from '../config'
import { createAcpAgentApp } from './agent-server'

const originalWorkspaceRoot = workspaceRoot
const tempRoots: string[] = []

afterEach(async () => {
  setWorkspaceRootForTesting(originalWorkspaceRoot)
  await Promise.all(tempRoots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
})

describe('Gambit ACP agent', () => {
  test('negotiates capabilities and manages a session', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'gambit-acp-agent-'))
    tempRoots.push(root)
    const commandsDir = path.join(root, '.gambit', 'commands')
    await mkdir(commandsDir, { recursive: true })
    await writeFile(path.join(commandsDir, 'review.md'), [
      '---',
      'description: Review the requested code.',
      'argument-hint: <path>',
      '---',
      'Review $ARGUMENTS.',
    ].join('\n'))
    const agentMessages: string[] = []
    let publishedCommandNames: string[] = []
    let resolveCommands: (() => void) | null = null
    const commandsPublished = new Promise<void>((resolve) => {
      resolveCommands = resolve
    })
    const client = acp.client({ name: 'test-client' })
      .onNotification(acp.methods.client.session.update, ({ params }) => {
        if (params.update.sessionUpdate === 'available_commands_update') {
          publishedCommandNames = params.update.availableCommands.map((command) => command.name)
          expect(params.update.availableCommands.some((command) => command.name === 'model')).toBe(true)
          resolveCommands?.()
        } else if (params.update.sessionUpdate === 'agent_message_chunk'
          && params.update.content.type === 'text') {
          agentMessages.push(params.update.content.text)
        }
      })
    const connection = client.connect(createAcpAgentApp({
      modelCatalogLoader: async () => [],
    }))

    try {
      const initialized = await connection.agent.request(acp.methods.agent.initialize, {
        protocolVersion: acp.PROTOCOL_VERSION,
        clientCapabilities: {},
      })
      expect(initialized.protocolVersion).toBe(acp.PROTOCOL_VERSION)
      expect(initialized.agentCapabilities?.sessionCapabilities?.resume).toEqual({})

      const created = await connection.agent.request(acp.methods.agent.session.new, {
        cwd: root,
        mcpServers: [],
      })
      expect(created.sessionId).toBeTruthy()
      expect(created.configOptions?.map((option) => option.id)).toEqual([
        'model',
        'permission-mode',
        'reasoning-effort',
      ])
      const modelOption = created.configOptions?.find((option) => option.id === 'model')
      expect(modelOption?.category).toBe('model')
      if (!modelOption || modelOption.type !== 'select') throw new Error('Missing ACP model selector.')
      const selectableModel = modelOption.options.find((option) => 'value' in option
        && option.value !== '__gambit_no_model__')
      if (!selectableModel || !('value' in selectableModel)) throw new Error('Missing selectable ACP model.')

      const selected = await connection.agent.request(acp.methods.agent.session.setConfigOption, {
        sessionId: created.sessionId,
        configId: 'model',
        value: selectableModel.value,
      })
      expect(selected.configOptions.find((option) => option.id === 'model')?.currentValue).toBe(selectableModel.value)
      await commandsPublished
      expect(publishedCommandNames).toContain('help')
      expect(publishedCommandNames).toContain('compact')
      expect(publishedCommandNames).toContain('review')

      const helpResult = await connection.agent.request(acp.methods.agent.session.prompt, {
        sessionId: created.sessionId,
        prompt: [{ type: 'text', text: '/help' }],
      })
      expect(helpResult.stopReason).toBe('end_turn')
      expect(agentMessages.at(-1)).toContain('/review <path>')

      const commandResult = await connection.agent.request(acp.methods.agent.session.prompt, {
        sessionId: created.sessionId,
        prompt: [{ type: 'text', text: `/model ${selectableModel.value}` }],
      })
      expect(commandResult.stopReason).toBe('end_turn')
      expect(agentMessages.at(-1)).toBe(`Model set to ${selectableModel.value}.`)

      const listed = await connection.agent.request(acp.methods.agent.session.list, { cwd: root })
      expect(listed.sessions.some((session) => session.sessionId === created.sessionId)).toBe(true)

      const configured = await connection.agent.request(acp.methods.agent.session.setConfigOption, {
        sessionId: created.sessionId,
        configId: 'permission-mode',
        value: 'Auto-accept',
      })
      expect(configured.configOptions.find((option) => option.id === 'permission-mode')?.currentValue).toBe('Auto-accept')

      await connection.agent.request(acp.methods.agent.session.close, {
        sessionId: created.sessionId,
      })
    } finally {
      connection.close()
      await connection.closed
    }
  })
})
