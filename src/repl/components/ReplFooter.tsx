import { Fragment } from 'react'
import { TextAttributes } from '@opentui/core'

import type { TaskRecord } from '../../tasks/task-types'
import { TaskPanel } from '../../ui/panels/TaskPanel'
import { theme } from '../../ui/theme'
import { formatTokenCount } from '../repl-format'

export interface FooterSegment {
  key: string
  content: string
  fg: string
  attributes?: number
}

export function ReplFooter({
  segments,
  contextUsage,
  shortModelDisplay,
  activeTasks,
  goalActive,
}: {
  segments: FooterSegment[]
  contextUsage: { used: number; max: number } | null
  shortModelDisplay: string
  activeTasks: TaskRecord[]
  goalActive: boolean
}) {
  return (
    <box flexDirection="row" flexShrink={0} justifyContent="space-between" paddingX={1} paddingTop={1}>
      <box flexDirection="row" flexShrink={1}>
        {segments.map((segment, index) => (
          <Fragment key={segment.key}>
            {index > 0 ? (
              <text fg={theme.statusFg} attributes={TextAttributes.DIM} content=" · " />
            ) : null}
            <text fg={segment.fg} attributes={segment.attributes} content={segment.content} />
          </Fragment>
        ))}
      </box>
      <box flexDirection="row" flexShrink={0} gap={2}>
        {contextUsage ? (
          <text
            fg={
              contextUsage.used / contextUsage.max > 0.85
                ? theme.errorFg
                : contextUsage.used / contextUsage.max > 0.6
                  ? theme.warningFg
                  : theme.statusFg
            }
            attributes={TextAttributes.DIM}
          >
            <span fg={theme.headerAccent}>{shortModelDisplay}</span>
            {` ${formatTokenCount(contextUsage.used)}/${formatTokenCount(contextUsage.max)}`}
          </text>
        ) : null}
        <TaskPanel tasks={activeTasks} goalActive={goalActive} />
      </box>
    </box>
  )
}
