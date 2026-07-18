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
  isActiveTaskStatus,
  truncateMiddle,
} from '../repl-format'

interface UseReplStatusOptions {
  conversation: {
    conversationId: string
    status: 'idle' | 'running'
  }
  tasks: TaskRecord[]
  modelId: string | null
  reasoningEffort: ReasoningEffort | null
  providerSlug: string | null
  thinkingEnabled: boolean
  permissionMode: PermissionMode
  isLight: boolean
  terminalWidth: number
  followUpCount: number
}

export function useReplStatus({
  conversation,
  tasks,
  modelId,
  reasoningEffort,
  providerSlug,
  thinkingEnabled,
  permissionMode,
  isLight,
  terminalWidth,
  followUpCount,
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

  const activeTasks = tasks.filter((task) => isActiveTaskStatus(task.status))
  const recentTasks = tasks
    .filter((task) => !isActiveTaskStatus(task.status))
    .slice(0, 8)
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
      ? `running ${statusElapsed}${followUpCount > 0 ? ` (${followUpCount} queued)` : ''}`
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
    ? `${responseSpinner} ${statusElapsed ?? 'running'}${followUpCount > 0 ? ` (${followUpCount} queued)` : ''}`
    : statusDisplay

  const footerSegments: FooterSegment[] = [
    ...(tinyFooter
      ? []
      : [
          {
            key: 'thinking',
            content: compactFooter ? (thinkingEnabled ? '*' : 'o') : `${thinkingEnabled ? '*' : 'o'} think`,
            fg: thinkingEnabled ? theme.successFg : theme.statusFg,
            attributes: thinkingEnabled ? TextAttributes.BOLD : TextAttributes.DIM,
          },
        ]),
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
