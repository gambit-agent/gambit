import { afterEach, expect, test } from 'bun:test'
import { testRender } from '@opentui/react/test-utils'
import { act } from 'react'

import type { ModelPickerState } from '../../lib/modelPicker'
import type { ModelListItem } from '../../lib/openrouterModels'
import { ModelPickerOverlay } from './ModelPickerOverlay'

let testSetup: Awaited<ReturnType<typeof testRender>> | null = null

afterEach(async () => {
  await act(async () => {
    testSetup?.renderer.destroy()
  })
  testSetup = null
})

function model(id: string, name: string): ModelListItem {
  return {
    id,
    name,
    description: null,
    provider: id.split('/')[0] ?? null,
    promptPrice: null,
    completionPrice: null,
    requestPrice: null,
    supportsReasoning: false,
    reasoningEfforts: null,
    defaultReasoningEffort: null,
  }
}

test('renders an available model in a compact terminal', async () => {
  const models = [
    model('codex/gpt-5.6', 'GPT-5.6 Codex'),
    model('qwen/qwen3.6-plus', 'Qwen 3.6 Plus'),
  ]
  const state: ModelPickerState = {
    isOpen: true,
    mode: 'list',
    filterValue: '',
    hint: null,
    reasoningInput: 'medium',
    reasoningError: null,
    fetchState: 'idle',
    fetchError: null,
    providerFetchState: 'idle',
    providerFetchError: null,
    filteredModels: models,
    allModels: models,
    providerOptions: [],
    selectedProviderIndex: 0,
    selectedIndex: 0,
    reasoningEffort: null,
    providerSlug: null,
    pendingModel: null,
  }

  testSetup = await testRender(
    <ModelPickerOverlay
      state={state}
      currentModelId=""
      hasFocus
      onFilterChange={() => undefined}
      onFilterSubmit={() => undefined}
      onOptionChange={() => undefined}
      onOptionSelect={() => undefined}
      onProviderOptionChange={() => undefined}
      onProviderOptionSelect={() => undefined}
    />,
    { width: 80, height: 14 },
  )

  await testSetup.renderOnce()
  const frame = testSetup.captureCharFrame()

  expect(frame).toContain('GPT-5.6 Codex')
})
