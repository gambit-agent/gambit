import { detectImageMediaType } from './image-attachments'

/**
 * Reads an image off the system clipboard so `Ctrl+V` can attach a screenshot
 * the terminal itself never delivers — a bracketed paste carries only text, so
 * without this an image copied from a screenshot tool pastes as nothing.
 */

export interface ClipboardImage {
  bytes: Uint8Array
  mediaType: string
}

/**
 * Each candidate writes the clipboard image to stdout as raw bytes, or exits
 * non-zero when the clipboard holds no image. They are tried in order.
 */
export function getClipboardImageCommandCandidates(platform: NodeJS.Platform): string[][] {
  switch (platform) {
    case 'win32':
      return [
        [
          'powershell',
          '-NoProfile',
          '-STA',
          '-Command',
          // Add-Type is needed because [Windows.Forms.Clipboard] is not loaded
          // in a bare PowerShell session; -STA because the clipboard API
          // requires a single-threaded apartment.
          'Add-Type -AssemblyName System.Windows.Forms;' +
            '$image = [Windows.Forms.Clipboard]::GetImage();' +
            'if ($image -eq $null) { exit 1 };' +
            '$stream = New-Object System.IO.MemoryStream;' +
            '$image.Save($stream, [System.Drawing.Imaging.ImageFormat]::Png);' +
            '$out = [Console]::OpenStandardOutput();' +
            '$stream.WriteTo($out);' +
            '$out.Flush()',
        ],
      ]
    case 'darwin':
      return [
        // osascript writes an AppleScript «data PNGf…» hex blob, so go through
        // a temp file instead and cat it back out as bytes.
        [
          'sh',
          '-c',
          'f=$(mktemp -t gambit-clipboard).png; ' +
            'osascript -e "set f to open for access POSIX file \\"$f\\" with write permission" ' +
            '-e "write (the clipboard as «class PNGf») to f" -e "close access f" >/dev/null 2>&1 || ' +
            '{ rm -f "$f"; exit 1; }; ' +
            'cat "$f"; rm -f "$f"',
        ],
      ]
    default:
      return [
        ['wl-paste', '--type', 'image/png'],
        ['xclip', '-selection', 'clipboard', '-t', 'image/png', '-o'],
      ]
  }
}

/**
 * Text counterparts, used when `Ctrl+V` reaches us in a terminal that does not
 * turn it into a bracketed paste of its own. Without them the key would look
 * broken whenever the clipboard holds text rather than an image.
 */
export function getClipboardTextCommandCandidates(platform: NodeJS.Platform): string[][] {
  switch (platform) {
    case 'win32':
      return [['powershell', '-NoProfile', '-Command', 'Get-Clipboard -Raw']]
    case 'darwin':
      return [['pbpaste']]
    default:
      return [
        ['wl-paste', '--no-newline'],
        ['xclip', '-selection', 'clipboard', '-o'],
        ['xsel', '--clipboard', '--output'],
      ]
  }
}

async function runClipboardImageCommand(command: string[]): Promise<Uint8Array | null> {
  const child = Bun.spawn(command, { stdin: 'ignore', stdout: 'pipe', stderr: 'ignore' })
  const bytes = new Uint8Array(await new Response(child.stdout).arrayBuffer())
  const exitCode = await child.exited
  if (exitCode !== 0 || bytes.byteLength === 0) {
    return null
  }
  return bytes
}

/**
 * Returns the clipboard's image, or null when it holds none, no helper is
 * installed, or the bytes are not a format we can attach. Never throws: a
 * `Ctrl+V` on a text clipboard is ordinary, not an error worth reporting.
 */
export async function readClipboardImage(
  platform: NodeJS.Platform = process.platform,
  run: (command: string[]) => Promise<Uint8Array | null> = runClipboardImageCommand,
): Promise<ClipboardImage | null> {
  for (const command of getClipboardImageCommandCandidates(platform)) {
    let bytes: Uint8Array | null = null
    try {
      bytes = await run(command)
    } catch {
      // The helper is missing or refused to run; try the next candidate.
      continue
    }
    if (!bytes) {
      continue
    }
    const mediaType = detectImageMediaType(bytes)
    if (mediaType) {
      return { bytes, mediaType }
    }
  }
  return null
}

/**
 * Returns the clipboard's text, or null when it holds none. Like the image
 * read, it never throws — a missing helper just means no fallback.
 */
export async function readClipboardText(
  platform: NodeJS.Platform = process.platform,
  run: (command: string[]) => Promise<Uint8Array | null> = runClipboardImageCommand,
): Promise<string | null> {
  for (const command of getClipboardTextCommandCandidates(platform)) {
    let bytes: Uint8Array | null = null
    try {
      bytes = await run(command)
    } catch {
      continue
    }
    if (!bytes) {
      continue
    }
    // `Get-Clipboard -Raw` appends a trailing newline of its own.
    const text = new TextDecoder().decode(bytes).replace(/\r\n?/g, '\n').replace(/\n$/, '')
    if (text) {
      return text
    }
  }
  return null
}
