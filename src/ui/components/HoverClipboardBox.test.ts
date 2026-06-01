import { expect, test } from 'bun:test'
import { MouseButton } from '@opentui/core'

import { isRightClickCopyEvent } from './HoverClipboardBox'

test('identifies right-click copy mouse events', () => {
  expect(isRightClickCopyEvent({ button: MouseButton.RIGHT })).toBe(true)
  expect(isRightClickCopyEvent({ button: MouseButton.LEFT })).toBe(false)
  expect(isRightClickCopyEvent({ button: MouseButton.MIDDLE })).toBe(false)
})
