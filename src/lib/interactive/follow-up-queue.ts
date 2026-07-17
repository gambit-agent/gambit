import { useCallback, useRef, useState } from 'react'

export function useFollowUpQueue() {
  const followUpQueueRef = useRef<string[]>([])
  const [followUpQueue, setFollowUpQueue] = useState<string[]>([])

  const enqueueFollowUp = useCallback((value: string) => {
    followUpQueueRef.current = [...followUpQueueRef.current, value]
    setFollowUpQueue([...followUpQueueRef.current])
  }, [])

  const drainFollowUp = useCallback(() => {
    if (followUpQueueRef.current.length === 0) return undefined
    const next = followUpQueueRef.current[0]
    followUpQueueRef.current = followUpQueueRef.current.slice(1)
    setFollowUpQueue([...followUpQueueRef.current])
    return next
  }, [])

  return {
    followUpQueue,
    enqueueFollowUp,
    drainFollowUp,
  }
}
