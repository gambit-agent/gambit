import { expect, test } from 'bun:test'

import { agentToolIds } from './agent-tool-policy'
import { DEFAULT_AGENT_DEFINITIONS } from './agent-definitions'
import { AgentRunner } from './agent-runner'

test('default delegated agent uses the scoped child-agent tool policy', async () => {
  const runner = new AgentRunner()
  let capturedAllowedToolIds: readonly string[] | undefined

  await expect(
    runner.run({
      definition: DEFAULT_AGENT_DEFINITIONS.default,
      prompt: 'inspect',
      apiKey: 'test-key',
      modelId: 'test-model',
      baseSystemPrompt: 'base',
      createTools: async (allowedToolIds) => {
        capturedAllowedToolIds = allowedToolIds
        throw new Error('stop before model stream')
      },
      appendTranscript: async () => {},
      updateProgress: async () => {},
    }),
  ).rejects.toThrow('stop before model stream')

  expect(capturedAllowedToolIds).toEqual([...agentToolIds])
})

test('explorer delegated agent cannot spawn higher-privilege child agents', () => {
  expect(DEFAULT_AGENT_DEFINITIONS.explorer.allowedToolIds).not.toContain('spawnAgent')
  expect(DEFAULT_AGENT_DEFINITIONS.explorer.allowedToolIds).not.toContain('runAgents')
  expect(DEFAULT_AGENT_DEFINITIONS.explorer.allowedToolIds).not.toContain('workflow')
})
