import { afterEach, expect, test } from 'bun:test'
import type { PasteEvent } from '@opentui/core'
import { testRender } from '@opentui/react/test-utils'
import { act } from 'react'
import type { MutableRefObject } from 'react'

import type { InteractiveHistory } from './history'
import { usePasteDetection } from './paste-detection'

let testSetup: Awaited<ReturnType<typeof testRender>> | null = null

afterEach(async () => {
  await act(async () => {
    testSetup?.renderer.destroy()
  })
  testSetup = null
})

type PasteHandler = (event: PasteEvent) => void

class FakeKeyInput {
  handlers = new Set<PasteHandler>()
  on(_event: 'paste', handler: PasteHandler) {
    this.handlers.add(handler)
  }
  off(_event: 'paste', handler: PasteHandler) {
    this.handlers.delete(handler)
  }
  emitPaste(event: FakePasteEvent) {
    for (const handler of this.handlers) {
      handler(event as unknown as PasteEvent)
    }
  }
}

class FakePasteEvent {
  bytes: Uint8Array
  metadata?: { mimeType?: string; kind?: 'text' | 'binary' | 'unknown' }
  defaultPrevented = false
  constructor(value: string | Uint8Array, metadata?: FakePasteEvent['metadata']) {
    this.bytes = typeof value === 'string' ? new TextEncoder().encode(value) : value
    this.metadata = metadata
  }
  preventDefault() {
    this.defaultPrevented = true
  }
}

function Harness({
  keyInput,
  enabled,
  values,
  previews,
  images = [],
}: {
  keyInput: FakeKeyInput
  enabled: boolean
  values: string[]
  previews: (string | null)[]
  images?: Array<{ bytes?: Uint8Array; mediaType?: string; path?: string }>
}) {
  const historyRef: MutableRefObject<InteractiveHistory | null> = { current: null }
  const suppressNextInputRef: MutableRefObject<boolean> = { current: false }
  usePasteDetection({
    renderer: { keyInput },
    inputPreview: null,
    setInputPreview: (next) => {
      previews.push(typeof next === 'function' ? next(null) : next)
    },
    setInputValueWithRef: (next) => {
      values.push(typeof next === 'function' ? next('') : next)
    },
    historyRef,
    suppressNextInputRef,
    onImagePaste: (image) => images.push(image),
    enabled,
  })
  return <text content="harness" />
}

test('captures paste into the main input when enabled', async () => {
  const keyInput = new FakeKeyInput()
  const values: string[] = []
  const previews: (string | null)[] = []

  testSetup = await testRender(
    <Harness keyInput={keyInput} enabled values={values} previews={previews} />,
    { width: 20, height: 4 },
  )

  const event = new FakePasteEvent('sk-test-key')
  await act(async () => {
    keyInput.emitPaste(event)
  })

  expect(event.defaultPrevented).toBe(true)
  expect(values).toEqual(['sk-test-key'])
  expect(previews).toEqual(['[Pasted Content 11 chars]'])
})

test('lets paste flow to the focused overlay input when disabled', async () => {
  const keyInput = new FakeKeyInput()
  const values: string[] = []
  const previews: (string | null)[] = []

  testSetup = await testRender(
    <Harness keyInput={keyInput} enabled={false} values={values} previews={previews} />,
    { width: 20, height: 4 },
  )

  const event = new FakePasteEvent('sk-test-key')
  await act(async () => {
    keyInput.emitPaste(event)
  })

  expect(event.defaultPrevented).toBe(false)
  expect(values).toEqual([])
  expect(previews).toEqual([])
})

test('captures binary image paste as an attachment instead of text', async () => {
  const keyInput = new FakeKeyInput()
  const values: string[] = []
  const previews: (string | null)[] = []
  const images: Array<{ bytes?: Uint8Array; mediaType?: string; path?: string }> = []
  const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])

  testSetup = await testRender(
    <Harness keyInput={keyInput} enabled values={values} previews={previews} images={images} />,
    { width: 20, height: 4 },
  )

  const event = new FakePasteEvent(png, { kind: 'binary', mimeType: 'image/png' })
  await act(async () => {
    keyInput.emitPaste(event)
  })

  expect(event.defaultPrevented).toBe(true)
  expect(values).toEqual([])
  expect(previews).toEqual([])
  expect(images[0]?.mediaType).toBe('image/png')
  expect(images[0]?.bytes).toEqual(png)
})
