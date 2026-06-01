import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'

export interface UpdateOptions {
  version?: string
  installDir?: string
  noModifyPath: boolean
  help: boolean
}

const DEFAULT_REPO = 'gambit-agent/gambit'
const DEFAULT_REF = 'main'

const UPDATE_HELP = `Update Gambit CLI.

Usage:
  gambit update [latest|VERSION]
  gambit update --version VERSION

Options:
  -h, --help             Show this help.
  -v, --version VERSION  Install a specific release version, with or without leading v.
  --install-dir PATH     Install directory. Defaults to the user-local bin directory.
  --no-modify-path       Do not update PATH.

Environment:
  GAMBIT_REPO            GitHub repository to download from. Default: gambit-agent/gambit.
  GAMBIT_INSTALL_REF     Git ref for the installer script. Default: main.
  GAMBIT_BIN_DIR         Install directory. Defaults to the user-local bin directory.
`

export function printUpdateHelp(): void {
  process.stdout.write(UPDATE_HELP)
}

export function parseUpdateArgs(args: string[]): UpdateOptions {
  const options: UpdateOptions = { noModifyPath: false, help: false }

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index] ?? ''

    if (arg === '-h' || arg === '--help') {
      options.help = true
      continue
    }

    if (arg === '--no-modify-path') {
      options.noModifyPath = true
      continue
    }

    if (arg === '-v' || arg === '--version') {
      const value = args[index + 1]
      if (!value) {
        throw new Error(`${arg} requires a version argument.`)
      }
      options.version = value
      index += 1
      continue
    }

    if (arg === '--install-dir') {
      const value = args[index + 1]
      if (!value) {
        throw new Error('--install-dir requires a path argument.')
      }
      options.installDir = value
      index += 1
      continue
    }

    if (arg.startsWith('-')) {
      throw new Error(`Unknown update option: ${arg}`)
    }

    if (options.version) {
      throw new Error(`Multiple versions provided: ${options.version} and ${arg}`)
    }

    options.version = arg
  }

  return options
}

export function buildInstallerArgs(options: UpdateOptions): string[] {
  const installerArgs: string[] = []

  if (options.version && options.version !== 'stable') {
    installerArgs.push(options.version)
  } else {
    installerArgs.push('latest')
  }

  if (options.installDir) {
    installerArgs.push('--install-dir', options.installDir)
  }

  if (options.noModifyPath) {
    installerArgs.push('--no-modify-path')
  }

  return installerArgs
}

export function buildPowerShellInstallerArgs(options: UpdateOptions): string[] {
  const installerArgs: string[] = []

  if (options.version && options.version !== 'stable') {
    installerArgs.push('-Version', options.version)
  } else {
    installerArgs.push('-Version', 'latest')
  }

  if (options.installDir) {
    installerArgs.push('-InstallDir', options.installDir)
  }

  if (options.noModifyPath) {
    installerArgs.push('-NoModifyPath')
  }

  return installerArgs
}

function resolveInstallerUrl(scriptName = 'install'): string {
  const repo = process.env.GAMBIT_REPO || DEFAULT_REPO
  const ref = process.env.GAMBIT_INSTALL_REF || DEFAULT_REF
  return `https://raw.githubusercontent.com/${repo}/${ref}/${scriptName}`
}

async function downloadInstaller(url: string): Promise<string> {
  const response = await fetch(url)
  if (!response.ok) {
    throw new Error(`failed to download installer (${response.status} ${response.statusText})`)
  }
  return response.text()
}

export function patchInstallerScript(installer: string): string {
  const oldLine = '  cp "$source" "$destination"'
  const newBlock = `  # Try cp first (works across filesystems). If the destination is a running
  # binary, fall back to same-dir temp copy + atomic mv.
  if cp "$source" "$destination" 2>/dev/null; then
    : # success
  else
    local tmp_dest="\${destination}.tmp.$$"
    cp "$source" "$tmp_dest" || { print_error "Failed to copy binary to temp path."; exit 1; }
    mv -f "$tmp_dest" "$destination" || { rm -f "$tmp_dest"; print_error "Failed to move binary into place."; exit 1; }
  fi`

  if (!installer.includes(oldLine)) {
    console.warn(
      'Warning: could not patch installer for "Text file busy" workaround.',
    )
    return installer
  }

  return installer.replace(oldLine, newBlock)
}

async function runWindowsUpdate(options: UpdateOptions): Promise<number> {
  const installerUrl = resolveInstallerUrl('install.ps1')
  const installerArgs = buildPowerShellInstallerArgs(options)

  console.log(`Updating Gambit using ${installerUrl}`)

  let tempDir: string | undefined
  try {
    const installer = await downloadInstaller(installerUrl)
    tempDir = await mkdtemp(path.join(tmpdir(), 'gambit-update-'))
    const installerPath = path.join(tempDir, 'install.ps1')
    await writeFile(installerPath, installer, 'utf8')

    const child = Bun.spawn(
      [
        'powershell.exe',
        '-NoProfile',
        '-ExecutionPolicy',
        'Bypass',
        '-File',
        installerPath,
        ...installerArgs,
        '-WaitForPid',
        String(process.pid),
        '-CleanupPath',
        tempDir,
      ],
      {
        stdout: 'inherit',
        stderr: 'inherit',
        stdin: 'ignore',
        env: process.env,
        detached: true,
      },
    )
    child.unref()

    console.log('The Windows installer will continue after Gambit exits.')
    return 0
  } catch (error) {
    if (tempDir) {
      await rm(tempDir, { recursive: true, force: true })
    }
    console.error(error instanceof Error ? error.message : String(error))
    return 1
  }
}

export async function runUpdate(args: string[]): Promise<number> {
  let options: UpdateOptions
  try {
    options = parseUpdateArgs(args)
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error))
    console.error('Run `gambit update --help` for usage.')
    return 1
  }

  if (options.help) {
    printUpdateHelp()
    return 0
  }

  if (process.platform === 'win32') {
    return runWindowsUpdate(options)
  }

  const installerUrl = resolveInstallerUrl()
  const installerArgs = buildInstallerArgs(options)

  console.log(`Updating Gambit using ${installerUrl}`)

  let tempDir: string | undefined
  try {
    const installer = await downloadInstaller(installerUrl)
    const patchedInstaller = patchInstallerScript(installer)
    tempDir = await mkdtemp(path.join(tmpdir(), 'gambit-update-'))
    const installerPath = path.join(tempDir, 'install')
    await writeFile(installerPath, patchedInstaller, 'utf8')

    const child = Bun.spawn(['bash', installerPath, ...installerArgs], {
      stdout: 'inherit',
      stderr: 'inherit',
      stdin: 'inherit',
      env: process.env,
    })

    return await child.exited
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error))
    return 1
  } finally {
    if (tempDir) {
      await rm(tempDir, { recursive: true, force: true })
    }
  }
}
