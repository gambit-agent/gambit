import { useCallback, useEffect, useRef, type RefObject } from 'react'
import type { ScrollBoxRenderable } from '@opentui/core'

/**
 * How close (in rows) the viewport must be to the bottom for auto-scroll to
 * engage. Anything farther means the user scrolled up to read scrollback and
 * must not be yanked back down while messages stream in.
 */
export const AUTO_SCROLL_THRESHOLD_ROWS = 1

/**
 * Pure decision helper: returns the scrollTop to apply, or null to leave the
 * viewport alone. `forced` bypasses the read-scrollback protection (used for
 * the user's own submission, which must always come into view).
 */
export function getAutoScrollTarget({
  scrollTop,
  scrollHeight,
  viewportHeight,
  forced,
}: {
  scrollTop: number
  scrollHeight: number
  viewportHeight: number
  forced: boolean
}): number | null {
  const maxScrollTop = Math.max(0, scrollHeight - viewportHeight)
  if (!forced && maxScrollTop - scrollTop > AUTO_SCROLL_THRESHOLD_ROWS) {
    return null
  }
  return maxScrollTop
}

export function useConversationAutoScroll(
  scrollboxRef: RefObject<ScrollBoxRenderable | null>,
  dependency: unknown,
): { scrollToBottom: () => void } {
  // Set when the user submits: the submitted message lands in the
  // conversation *after* the submit handler runs, so the next
  // dependency-driven pass must scroll unconditionally even though the new
  // content pushed the viewport further than the sticky threshold.
  const forceNextRef = useRef(false)

  const scrollToBottom = useCallback(() => {
    forceNextRef.current = true
    const scrollbox = scrollboxRef.current
    if (scrollbox) {
      scrollbox.scrollTo(Math.max(0, scrollbox.scrollHeight - (scrollbox.viewport.height ?? 0)))
    }
  }, [scrollboxRef])

  useEffect(() => {
    const scrollbox = scrollboxRef.current
    if (!scrollbox) {
      return
    }

    const forced = forceNextRef.current
    forceNextRef.current = false
    // The scrollbox's stickyScroll/stickyStart="bottom" keeps a pinned
    // viewport at the bottom as content grows; this hook only acts as a
    // backup when already at/near the bottom (or when forced by the user's
    // own submission), and bails otherwise so the user can read scrollback
    // during streaming.
    const target = getAutoScrollTarget({
      scrollTop: scrollbox.scrollTop,
      scrollHeight: scrollbox.scrollHeight,
      viewportHeight: scrollbox.viewport.height ?? 0,
      forced,
    })
    if (target !== null) {
      scrollbox.scrollTo(target)
    }
  }, [dependency, scrollboxRef])

  return { scrollToBottom }
}
