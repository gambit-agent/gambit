import { mkdtemp, rm } from 'node:fs/promises'
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

function printUpdateHelp(): void {
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

export function buildWindowsUpdateScript(
  pid: number,
  cleanupPath: string,
  repo: string,
  versionLabel: string,
  installDir: string,
  noModifyPath: boolean,
): string {
  const lines: string[] = []

  lines.push('param()')
  lines.push("$ErrorActionPreference = 'Stop'")
  lines.push('')
  lines.push(`$logFile = Join-Path "${cleanupPath}" "update.log"`)
  lines.push('function Log {')
  lines.push('  param([string]$Msg)')
  lines.push('  $timestamp = Get-Date -Format "yyyy-MM-dd HH:mm:ss"')
  lines.push('  "$timestamp $Msg" | Out-File -Append -LiteralPath $logFile')
  lines.push('}')
  lines.push('')
  lines.push('function Wait-ForProcessExit {')
  lines.push('  param([int]$ProcessId)')
  lines.push('  if ($ProcessId -le 0) { return }')
  lines.push('  try {')
  lines.push('    $p = Get-Process -Id $ProcessId -ErrorAction Stop')
  lines.push('    Log "Waiting for Gambit process $ProcessId to exit..."')
  lines.push('    $p.WaitForExit()')
  lines.push('    Log "Gambit process $ProcessId has exited."')
  lines.push('  } catch {')
  lines.push('    Log "Process $ProcessId not found (already exited)."')
  lines.push('  }')
  lines.push('}')
  lines.push('')
  lines.push('function Resolve-InstallDir {')
  if (installDir) {
    lines.push(`  return "${installDir}"`)
  } else {
    lines.push('  if ($env:GAMBIT_BIN_DIR) { return $env:GAMBIT_BIN_DIR }')
    lines.push("  return Join-Path $HOME '.local\\bin'")
  }
  lines.push('}')
  lines.push('')
  lines.push('function Get-Platform {')
  lines.push("  $rawArch = ''")
  lines.push('  try {')
  lines.push('    $rawArch = [System.Runtime.InteropServices.RuntimeInformation]::OSArchitecture.ToString()')
  lines.push('  } catch {')
  lines.push('    $rawArch = if ($env:PROCESSOR_ARCHITEW6432) { $env:PROCESSOR_ARCHITEW6432 } else { $env:PROCESSOR_ARCHITECTURE }')
  lines.push('  }')
  lines.push('  switch ($rawArch.ToLowerInvariant()) {')
  lines.push("    { $_ -in @('x64', 'amd64') } { return 'windows-x64' }")
  lines.push("    { $_ -in @('arm64', 'aarch64') } { throw 'Windows ARM64 release binaries are not published yet.' }")
  lines.push('    default { throw "Unsupported architecture: $rawArch" }')
  lines.push('  }')
  lines.push('}')
  lines.push('')
  lines.push('function Normalize-PathEntry {')
  lines.push('  param([string]$Entry)')
  lines.push("  try { return [System.IO.Path]::GetFullPath($Entry).TrimEnd('\\') }")
  lines.push("  catch { return $Entry.TrimEnd('\\') }")
  lines.push('}')
  lines.push('')
  lines.push('function Test-PathContainsDirectory {')
  lines.push('  param([string]$PathValue, [string]$Directory)')
  lines.push('  if (-not $PathValue) { return $false }')
  lines.push('  $target = Normalize-PathEntry $Directory')
  lines.push("  foreach ($entry in $PathValue.Split(';', [System.StringSplitOptions]::RemoveEmptyEntries)) {")
  lines.push('    if ((Normalize-PathEntry $entry) -ieq $target) { return $true }')
  lines.push('  }')
  lines.push('  return $false')
  lines.push('}')
  lines.push('')
  lines.push('function Add-ToUserPath {')
  lines.push('  param([string]$Directory)')
  if (noModifyPath) {
    lines.push('  return')
  } else {
    lines.push('  if (Test-PathContainsDirectory $env:Path $Directory) { return }')
    lines.push('  try {')
    lines.push("    $userPath = [Environment]::GetEnvironmentVariable('Path', 'User')")
    lines.push('    if (Test-PathContainsDirectory $userPath $Directory) { $env:Path = "$env:Path;$Directory"; return }')
    lines.push('    $newPath = if ($userPath) { "$userPath;$Directory" } else { $Directory }')
    lines.push("    [Environment]::SetEnvironmentVariable('Path', $newPath, 'User')")
    lines.push('    $env:Path = "$env:Path;$Directory"')
    lines.push('    Log "Added $Directory to user PATH."')
    lines.push('  } catch {')
    lines.push('    Log "WARNING: Could not update user PATH. Add this directory manually: $Directory"')
    lines.push('  }')
  }
  lines.push('}')
  lines.push('')
  lines.push('function Install-Binary {')
  lines.push('  param([string]$Source, [string]$DestinationDirectory)')
  lines.push('  New-Item -ItemType Directory -Force -Path $DestinationDirectory | Out-Null')
  lines.push('  $destination = Join-Path $DestinationDirectory "gambit.exe"')
  lines.push('  $copyError = $null')
  lines.push('  for ($attempt = 1; $attempt -le 10; $attempt += 1) {')
  lines.push('    try {')
  lines.push('      Copy-Item -LiteralPath $Source -Destination $destination -Force')
  lines.push('      $copyError = $null')
  lines.push('      break')
  lines.push('    } catch {')
  lines.push('      $copyError = $_')
  lines.push('      if ($attempt -eq 10) { break }')
  lines.push('      Start-Sleep -Milliseconds 250')
  lines.push('    }')
  lines.push('  }')
  lines.push('  if ($copyError) { throw $copyError }')
  lines.push('  if (Get-Command Unblock-File -ErrorAction SilentlyContinue) {')
  lines.push('    Unblock-File -LiteralPath $destination -ErrorAction SilentlyContinue')
  lines.push('  }')
  lines.push('  Log "Installed gambit to $destination"')
  lines.push('}')
  lines.push('')
  lines.push('try {')
  lines.push('  [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12')
  lines.push('} catch {}')
  lines.push('')
  lines.push(`Wait-ForProcessExit ${pid}`)
  lines.push('')
  lines.push('$resolvedInstallDir = Resolve-InstallDir')
  lines.push('$platform = Get-Platform')
  lines.push('$binaryName = "gambit-$platform.exe"')
  lines.push(`$releaseBase = "https://github.com/${repo}/releases"`)
  lines.push('')
  lines.push(`$versionLabel = "${versionLabel}"`)
  lines.push("if ($versionLabel -eq 'latest' -or $versionLabel -eq 'stable') {")
  lines.push('  $manifestUrl = "$releaseBase/latest/download/manifest.json"')
  lines.push('  $binaryUrl = "$releaseBase/latest/download/$binaryName"')
  lines.push('} else {')
  lines.push("  $normalizedVersion = $versionLabel.TrimStart('v')")
  lines.push('  $manifestUrl = "$releaseBase/download/v$normalizedVersion/manifest.json"')
  lines.push('  $binaryUrl = "$releaseBase/download/v$normalizedVersion/$binaryName"')
  lines.push('  $versionLabel = "v$normalizedVersion"')
  lines.push('}')
  lines.push('')
  lines.push('Log "Installing gambit ($versionLabel, $platform)"')
  lines.push('')
  lines.push('try {')
  lines.push('  $manifestJson = (Invoke-WebRequest -UseBasicParsing -Uri $manifestUrl).Content')
  lines.push('  $manifest = $manifestJson | ConvertFrom-Json')
  lines.push('  $specificVersion = $manifest.version')
  lines.push('  $platformProperty = $manifest.platforms.PSObject.Properties[$platform]')
  lines.push('  if ($null -eq $platformProperty) {')
  lines.push('    $platformProperty = $manifest.platforms.PSObject.Properties["$platform.exe"]')
  lines.push('  }')
  lines.push("  $checksum = if ($platformProperty) { [string]$platformProperty.Value.checksum } else { '' }")
  lines.push("  if ((-not $checksum) -or ($checksum -notmatch '^[a-fA-F0-9]{64}$')) {")
  lines.push('    throw "$platform is not available in the release manifest."')
  lines.push('  }')
  lines.push('  Log "Release version: $specificVersion"')
  lines.push('')
  lines.push(`  $downloadPath = Join-Path "${cleanupPath}" $binaryName`)
  lines.push('  Log "Downloading $binaryUrl ..."')
  lines.push('  Invoke-WebRequest -UseBasicParsing -Uri $binaryUrl -OutFile $downloadPath')
  lines.push('  Log "Downloaded $binaryName."')
  lines.push('')
  lines.push('  $actualChecksum = (Get-FileHash -LiteralPath $downloadPath -Algorithm SHA256).Hash.ToLowerInvariant()')
  lines.push('  if ($actualChecksum -ne $checksum.ToLowerInvariant()) {')
  lines.push('    throw "Checksum verification failed. Expected $checksum, got $actualChecksum."')
  lines.push('  }')
  lines.push('  Log "Checksum verified."')
  lines.push('')
  lines.push('  Install-Binary -Source $downloadPath -DestinationDirectory $resolvedInstallDir | Out-Null')
  lines.push('  Add-ToUserPath $resolvedInstallDir')
  lines.push('')
  lines.push('  if ($specificVersion) {')
  lines.push('    Log "Gambit $specificVersion installed successfully."')
  lines.push('  } else {')
  lines.push('    Log "Gambit installed successfully."')
  lines.push('  }')
  lines.push('} finally {')
  lines.push(`  Remove-Item -LiteralPath "${cleanupPath}" -Recurse -Force -ErrorAction SilentlyContinue`)
  lines.push('}')
  lines.push('')

  return lines.join('\n')
}

async function runWindowsUpdate(options: UpdateOptions): Promise<number> {
  const repo = process.env.GAMBIT_REPO || DEFAULT_REPO

  console.log(`Updating Gambit from ${repo}/releases`)

  let tempDir: string | undefined
  try {
    tempDir = await mkdtemp(path.join(tmpdir(), 'gambit-update-'))

    const versionLabel = options.version && options.version !== 'stable' ? options.version : 'latest'
    const installDir = options.installDir || ''

    const scriptContent = buildWindowsUpdateScript(
      process.pid,
      tempDir,
      repo,
      versionLabel,
      installDir,
      options.noModifyPath,
    )

    const scriptPath = path.join(tempDir, 'update-gambit.ps1')
    await Bun.write(scriptPath, scriptContent)

    const logPath = path.join(tempDir, 'update.log')

    // Use cmd /c start to properly create a new process group independent
    // of the parent's job object. This ensures the PowerShell helper
    // survives when Gambit exits (unlike Bun.spawn detached: true on Windows).
    const child = Bun.spawn(
      [
        'cmd.exe',
        '/c',
        'start',
        '/min',
        'powershell.exe',
        '-NoProfile',
        '-ExecutionPolicy',
        'Bypass',
        '-File',
        scriptPath,
      ],
      {
        stdout: 'ignore',
        stderr: 'ignore',
        stdin: 'ignore',
        env: process.env,
        detached: true,
      },
    )
    child.unref()

    console.log('')
    console.log('The Windows installer will continue after Gambit exits.')
    console.log('')
    console.log(`Update log: ${logPath}`)
    console.log('')
    console.log('Check the log file if the update does not complete.')
    return 0
  } catch (error) {
    if (tempDir) {
      await rm(tempDir, { recursive: true, force: true }).catch(() => {})
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
    await Bun.write(installerPath, patchedInstaller)

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