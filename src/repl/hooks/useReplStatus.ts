import { TextAttributes } from '@opentui/core'
import { useEffect, useRef, useState } from 'react'

import { RESPONSE_SPINNER_INTERVAL_MS, responseSpinnerFrames } from '../../config'
import type { ReasoningEffort } from '../../lib/model'
import type { TaskRecord } from '../../tasks/task-types'
import { theme } from '../../ui/theme'
import type { FooterSegment } from '../components/ReplFooter'
import type { PermissionMode } from '../../permissions/permission-rules'
import { useGitBranch } from './useGitBranch'
import {
  formatDuration,
  truncateMiddle,
} from '../repl-format'
import { splitTaskLists } from '../task-activity-model'

interface UseReplStatusOptions {
  conversation: {
    conversationId: string
    status: 'idle' | 'running'
  }
  tasks: TaskRecord[]
  modelId: string | null
  reasoningEffort: ReasoningEffort | null
  providerSlug: string | null
  permissionMode: PermissionMode
  isLight: boolean
  terminalWidth: number
  followUpCount: number
  /**
   * Subset of `followUpCount` the running turn will pick up at its next step
   * boundary. Always <= followUpCount.
   */
  steeringCount?: number
}

/**
 * Suffix describing composer input waiting on the running turn. Steering and
 * plain queueing are reported separately because they resolve at different
 * times — steering lands mid-turn, the rest waits for the turn to end.
 */
export function formatPendingInputLabel(followUpCount: number, steeringCount = 0): string {
  const steering = Math.min(Math.max(steeringCount, 0), followUpCount)
  const queued = followUpCount - steering
  const parts: string[] = []
  if (steering > 0) {
    parts.push(`${steering} steering`)
  }
  if (queued > 0) {
    parts.push(`${queued} queued`)
  }
  return parts.length > 0 ? ` (${parts.join(', ')})` : ''
}

export function useReplStatus({
  conversation,
  tasks,
  modelId,
  reasoningEffort,
  providerSlug,
  permissionMode,
  isLight,
  terminalWidth,
  followUpCount,
  steeringCount = 0,
}: UseReplStatusOptions) {
  const [statusElapsed, setStatusElapsed] = useState<string | null>(null)
  const [responseSpinnerFrame, setResponseSpinnerFrame] = useState(0)
  const statusStartedAtRef = useRef<Date | null>(null)
  const gitBranch = useGitBranch()

  useEffect(() => {
    if (conversation.status !== 'running') {
      statusStartedAtRef.current = null
      setStatusElapsed(null)
      return
    }

    statusStartedAtRef.current = new Date()
    setStatusElapsed(formatDuration(0))
    const intervalId = setInterval(() => {
      const startedAt = statusStartedAtRef.current
      if (!startedAt) {
        return
      }
      setStatusElapsed(formatDuration(Date.now() - startedAt.getTime()))
    }, 1000)

    return () => {
      clearInterval(intervalId)
    }
  }, [conversation.status])

  useEffect(() => {
    if (conversation.status !== 'running') {
      setResponseSpinnerFrame(0)
      return
    }

    setResponseSpinnerFrame(0)
    const intervalId = setInterval(() => {
      setResponseSpinnerFrame((current) => (current + 1) % responseSpinnerFrames.length)
    }, RESPONSE_SPINNER_INTERVAL_MS)

    return () => {
      clearInterval(intervalId)
    }
  }, [conversation.status])

  const { activeTasks, recentTasks } = splitTaskLists(tasks)
  // The task panel occupies the right side of the footer when tasks are active;
  // reserve its width so the left-side labels collapse instead of wrapping.
  const taskPanelReserve = activeTasks.length > 0 ? 36 : 0
  const footerWidth = terminalWidth - taskPanelReserve
  const selectedModelLabel = modelId ?? 'no model'
  const shortModelId = selectedModelLabel.includes('/') ? selectedModelLabel.split('/').pop()! : selectedModelLabel
  const modelSettingsLabel = `${shortModelId}${reasoningEffort ? `.${reasoningEffort}` : ''}${providerSlug ? `@${providerSlug}` : ''}`
  const shortModelDisplay = truncateMiddle(
    modelSettingsLabel,
    footerWidth < 100 ? 18 : 34,
  )
  const compactFooter = footerWidth < 120
  const tinyFooter = footerWidth < 88
  const statusDisplay =
    conversation.status === 'running' && statusElapsed
      ? `running ${statusElapsed}${formatPendingInputLabel(followUpCount, steeringCount)}`
      : conversation.status
  const responseSpinner = responseSpinnerFrames[responseSpinnerFrame] ?? responseSpinnerFrames[0]
  const permissionModeColor =
    permissionMode === 'Auto-accept'
      ? theme.successFg
      : permissionMode === 'Plan'
        ? theme.infoFg
        : permissionMode === 'Normal'
          ? theme.warningFg
          : theme.statusFg
  const activityLabel = conversation.status === 'running'
    ? `${responseSpinner} ${statusElapsed ?? 'running'}${formatPendingInputLabel(followUpCount, steeringCount)}`
    : statusDisplay

  const footerSegments: FooterSegment[] = [
    {
      key: 'mode',
      content: compactFooter ? permissionMode : `mode ${permissionMode}`,
      fg: permissionModeColor,
    },
    {
      key: 'branch',
      content: compactFooter
        ? truncateMiddle(gitBranch || '?', 18)
        : `git ${truncateMiddle(gitBranch || '?', 28)}`,
      fg: theme.statusFg,
      attributes: TextAttributes.DIM,
    },
    ...(tinyFooter
      ? []
      : [
          {
            key: 'session',
            content: compactFooter ? conversation.conversationId.slice(0, 6) : `session ${conversation.conversationId.slice(0, 6)}`,
            fg: theme.statusFg,
            attributes: TextAttributes.DIM,
          },
        ]),
    {
      key: 'activity',
      content: activityLabel,
      fg: conversation.status === 'running' ? theme.headerAccent : theme.statusFg,
      attributes: conversation.status === 'running' ? TextAttributes.BOLD : TextAttributes.DIM,
    },
  ]

  return {
    statusElapsed,
    shortModelDisplay,
    activeTasks,
    recentTasks,
    footerSegments,
  }
}
