import { useEffect, type RefObject } from 'react'
import type { ScrollBoxRenderable } from '@opentui/core'

export function useConversationAutoScroll(
  scrollboxRef: RefObject<ScrollBoxRenderable | null>,
  dependency: unknown,
): void {
  useEffect(() => {
    const scrollbox = scrollboxRef.current
    if (!scrollbox) {
      return
    }

    const viewportHeight = scrollbox.viewport.height ?? 0
    const maxScrollTop = Math.max(0, scrollbox.scrollHeight - viewportHeight)
    scrollbox.scrollTo(maxScrollTop)
  }, [dependency, scrollboxRef])
}
