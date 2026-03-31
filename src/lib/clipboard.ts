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

  const stderr = process.stderr ? (await new Response(process.stderr).text()).trim() : ''
  throw new Error(stderr || `Clipboard command exited with code ${exitCode}.`)
}

export async function copyTextToClipboard(text: string): Promise<void> {
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
