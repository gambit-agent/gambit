import path from 'node:path'
import { homedir } from 'node:os'

import { TextAttributes } from '@opentui/core'

import { workspaceRoot } from '../../config'
import { appVersion } from '../../app/version'
import { theme } from '../../ui/theme'
import { sessionTimestampFormatter } from '../repl-format'

export function formatHeaderWorkspacePath(rootPath: string, homePath: string = homedir()): string {
  const resolvedRoot = path.resolve(rootPath)
  const resolvedHome = path.resolve(homePath)
  const relative = path.relative(resolvedHome, resolvedRoot)

  if (relative === '') {
    return '~'
  }

  if (!relative.startsWith('..') && !path.isAbsolute(relative)) {
    return `~/${relative.split(path.sep).join('/')}`
  }

  return resolvedRoot
}

export function ReplHeader() {
  const workspacePath = formatHeaderWorkspacePath(workspaceRoot)

  return (
    <box
      flexDirection="row"
      justifyContent="space-between"
      alignItems="center"
      paddingTop={1}
      paddingBottom={1}
    >
      <text fg={theme.logoFg} attributes={TextAttributes.BOLD}>
        GAMBIT | v{appVersion} | <span fg={theme.statusFg} attributes={TextAttributes.DIM}>{sessionTimestampFormatter.format(new Date())}</span>
      </text>
      <text fg={theme.statusFg} attributes={TextAttributes.DIM}>
        {workspacePath}
      </text>
    </box>
  )
}
