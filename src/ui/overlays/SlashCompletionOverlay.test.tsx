import { afterEach, expect, test } from 'bun:test'
import { testRender } from '@opentui/react/test-utils'
import { act } from 'react'

import { SlashCompletionOverlay } from './SlashCompletionOverlay'
import type { SlashCompletionMatch } from '../../repl/slash-completions'

let setup: Awaited<ReturnType<typeof testRender>> | null = null

afterEach(async () => {
  await act(async () => {
    setup?.renderer.destroy()
  })
  setup = null
})

const results: SlashCompletionMatch[] = Array.from({ length: 30 }, (_, index) => ({
  key: `cmd-${index}`,
  label: `/command${index}`,
  kind: 'command',
  description: `Description ${index}`,
} as SlashCompletionMatch))

async function mount(selectedIndex: number) {
  setup = await testRender(
    <SlashCompletionOverlay isOpen query="" mode="command" selectedIndex={selectedIndex} results={results} />,
    { width: 100, height: 40 },
  )
  await setup.renderOnce()
  return setup.captureCharFrame()
}

test('renders the first page with the first item selected', async () => {
  const frame = await mount(0)
  expect(frame).toContain('/command0  command · Description 0')
  expect(frame).toContain('/command11')
  expect(frame).not.toContain('/command12 ')
  expect(frame).toContain('↓ 18 more')
  expect(frame).not.toContain('↑')
})

test('keeps a selection past the first page visible', async () => {
  const frame = await mount(20)
  expect(frame).toContain('/command20  command · Description 20')
  expect(frame).toContain('↑')
  expect(frame).toContain('21/30')
})

test('keeps the last item visible when selected', async () => {
  const frame = await mount(29)
  expect(frame).toContain('/command29  command · Description 29')
  expect(frame).toContain('/command18')
  expect(frame).not.toContain('↓')
})
