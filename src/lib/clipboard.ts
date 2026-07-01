import type { CliRenderer } from '@opentui/core'

import { collectBoundedText } from './process-output'

const COPY_NOTIFICATION_MESSAGE = 'Copied text to clipboard'
const COPY_NOTIFICATION_TITLE = 'Gambit'

export type ClipboardRenderer = Pick<
  CliRenderer,
  'copyToClipboardOSC52' | 'isOsc52Supported' | 'triggerNotification'
>

export function getClipboardCommandCandidates(platform: NodeJS.Platform): string[][] {
  switch (platform) {
    case 'win32':
      return [
        ['powershell', '-NoProfile', '-Command', 'Set-Clipboard -Value ([Console]::In.ReadToEnd())'],
        ['cmd', '/c', 'clip'],
      ]
    case 'darwin':
      return [['pbcopy']]
    default:
      return [
        ['wl-copy'],
        ['xclip', '-selection', 'clipboard'],
        ['xsel', '--clipboard', '--input'],
      ]
  }
}

async function runClipboardCommand(command: string[], text: string): Promise<void> {
  const process = Bun.spawn(command, {
    stdin: new Response(text),
    stdout: 'ignore',
    stderr: 'pipe',
  })

  const exitCode = await process.exited
  if (exitCode === 0) {
    return
  }

  const stderr = (await collectBoundedText(process.stderr, 4_000)).text.trim()
  throw new Error(stderr || `Clipboard command exited with code ${exitCode}.`)
}

async function copyTextToClipboard(text: string): Promise<void> {
  if (!text) {
    return
  }

  const commands = getClipboardCommandCandidates(process.platform)
  let lastError: unknown = null

  for (const command of commands) {
    try {
      await runClipboardCommand(command, text)
      return
    } catch (error) {
      lastError = error
    }
  }

  throw new Error(
    lastError instanceof Error
      ? `Failed to copy selection to clipboard: ${lastError.message}`
      : 'Failed to copy selection to clipboard.',
  )
}

export async function copyTextWithRendererClipboard(
  renderer: ClipboardRenderer,
  text: string,
  fallbackCopy: (value: string) => Promise<void> = copyTextToClipboard,
): Promise<boolean> {
  const trimmed = text.trim()
  if (!trimmed) {
    return false
  }

  const copiedViaOsc52 = renderer.isOsc52Supported() && renderer.copyToClipboardOSC52(text)
  if (!copiedViaOsc52) {
    await fallbackCopy(text)
  }

  renderer.triggerNotification(COPY_NOTIFICATION_MESSAGE, COPY_NOTIFICATION_TITLE)
  return true
}
