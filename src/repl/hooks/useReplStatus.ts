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

  const selectedModelLabel = modelId ?? 'no model'
  const shortModelId = selectedModelLabel.includes('/') ? selectedModelLabel.split('/').pop()! : selectedModelLabel
  const shortModelDisplay = truncateMiddle(
    reasoningEffort ? `${shortModelId}.${reasoningEffort}` : shortModelId,
    terminalWidth < 100 ? 18 : 34,
  )
  const activeTasks = tasks.filter((task) => isActiveTaskStatus(task.status))
  const recentTasks = tasks
    .filter((task) => !isActiveTaskStatus(task.status))
    .slice(0, 8)
  const compactFooter = terminalWidth < 120
  const tinyFooter = terminalWidth < 88
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
          {
            key: 'theme',
            content: compactFooter ? (isLight ? 'light' : 'dark') : `${isLight ? 'light' : 'dark'} theme`,
            fg: theme.statusFg,
            attributes: TextAttributes.DIM,
          },
        ]),
    {
      key: 'mode',
      content: compactFooter ? permissionMode : `mode ${permissionMode}`,
      fg: permissionModeColor,
    },
    {
      key: 'branch',
      content: compactFooter ? (gitBranch || '?') : `git ${gitBranch || '?'}`,
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
