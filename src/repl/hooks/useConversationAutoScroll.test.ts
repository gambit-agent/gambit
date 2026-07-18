import { describe, expect, it } from 'bun:test'

import { AUTO_SCROLL_THRESHOLD_ROWS, getAutoScrollTarget } from './useConversationAutoScroll'

describe('getAutoScrollTarget', () => {
  it('scrolls to the bottom when already pinned there', () => {
    expect(
      getAutoScrollTarget({ scrollTop: 80, scrollHeight: 100, viewportHeight: 20, forced: false }),
    ).toBe(80)
  })

  it('scrolls when within the sticky threshold of the bottom', () => {
    expect(
      getAutoScrollTarget({
        scrollTop: 80 - AUTO_SCROLL_THRESHOLD_ROWS,
        scrollHeight: 100,
        viewportHeight: 20,
        forced: false,
      }),
    ).toBe(80)
  })

  it('leaves the viewport alone while the user reads scrollback', () => {
    expect(
      getAutoScrollTarget({ scrollTop: 10, scrollHeight: 100, viewportHeight: 20, forced: false }),
    ).toBeNull()
  })

  it('always scrolls on the user\'s own submission, even from deep scrollback', () => {
    expect(
      getAutoScrollTarget({ scrollTop: 0, scrollHeight: 100, viewportHeight: 20, forced: true }),
    ).toBe(80)
  })

  it('clamps to zero when the content fits in the viewport', () => {
    expect(
      getAutoScrollTarget({ scrollTop: 0, scrollHeight: 10, viewportHeight: 20, forced: true }),
    ).toBe(0)
  })
})
