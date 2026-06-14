import { TextAttributes } from '@opentui/core'

import { appVersion } from '../../app/version'
import { theme } from '../../ui/theme'
import { sessionTimestampFormatter } from '../repl-format'

export function ReplHeader() {
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
    </box>
  )
}
