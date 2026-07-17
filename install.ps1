#Requires -Version 5.1
[CmdletBinding()]
param(
  [Parameter(Position = 0)]
  [string]$Release,

  [Alias('v')]
  [string]$Version,

  [Alias('b')]
  [string]$Binary,

  [string]$InstallDir,

  [switch]$NoModifyPath,

  [switch]$Help,

  [int]$WaitForPid = 0,

  [string]$CleanupPath
)

$ErrorActionPreference = 'Stop'

$App = 'gambit'
$Repo = if ($env:GAMBIT_REPO) { $env:GAMBIT_REPO } else { 'gambit-agent/gambit' }

function Show-Usage {
  @"
Install Gambit CLI.

Usage:
  irm https://raw.githubusercontent.com/gambit-agent/gambit/main/install.ps1 | iex
  & ([scriptblock]::Create((irm https://raw.githubusercontent.com/gambit-agent/gambit/main/install.ps1))) -Version 0.7.0
  .\install.ps1 -Binary .\gambit.exe

Options:
  -Help                 Show this help.
  -Version VERSION      Install a specific release version, with or without leading v.
  -Binary PATH          Install from a local compiled binary.
  -InstallDir PATH      Install directory. Defaults to `$HOME\.local\bin.
  -NoModifyPath         Do not update the user PATH.

Environment:
  GAMBIT_REPO           GitHub repository to download from. Default: gambit-agent/gambit.
  GAMBIT_BIN_DIR        Install directory. Default: `$HOME\.local\bin.
  VERSION               Release version to install when -Version is not passed.
"@
}

function Resolve-InstallDir {
  if ($InstallDir) {
    return $InstallDir
  }
  if ($env:GAMBIT_BIN_DIR) {
    return $env:GAMBIT_BIN_DIR
  }
  return Join-Path $HOME '.local\bin'
}

function Resolve-RequestedVersion {
  if ($Version -and $Release) {
    throw 'Provide a version either positionally or with -Version, not both.'
  }
  if ($Version) {
    return $Version
  }
  if ($Release) {
    return $Release
  }
  if ($env:VERSION) {
    return $env:VERSION
  }
  return ''
}

function Invoke-DownloadText {
  param([string]$Url)

  $parameters = @{
    Uri = $Url
    ErrorAction = 'Stop'
  }
  if ((Get-Command Invoke-WebRequest).Parameters.ContainsKey('UseBasicParsing')) {
    $parameters.UseBasicParsing = $true
  }

  $response = Invoke-WebRequest @parameters
  if ($response.Content -is [string]) {
    return $response.Content
  }
  if ($response.Content -is [byte[]]) {
    return [System.Text.Encoding]::UTF8.GetString([byte[]]$response.Content)
  }
  if ($response.Content -is [System.Array]) {
    return [System.Text.Encoding]::UTF8.GetString([byte[]]$response.Content)
  }
  return [string]$response.Content
}

function Invoke-DownloadFile {
  param(
    [string]$Url,
    [string]$Output
  )

  $parameters = @{
    Uri = $Url
    OutFile = $Output
    ErrorAction = 'Stop'
  }
  if ((Get-Command Invoke-WebRequest).Parameters.ContainsKey('UseBasicParsing')) {
    $parameters.UseBasicParsing = $true
  }

  Invoke-WebRequest @parameters
}

function Get-Platform {
  if (($env:OS -ne 'Windows_NT') -and (-not $IsWindows)) {
    throw 'The PowerShell installer supports Windows. On WSL, Linux, or macOS, use the Bash installer.'
  }

  $rawArch = ''
  try {
    $rawArch = [System.Runtime.InteropServices.RuntimeInformation]::OSArchitecture.ToString()
  } catch {
    $rawArch = ''
  }

  if (-not $rawArch) {
    $rawArch = if ($env:PROCESSOR_ARCHITEW6432) {
      $env:PROCESSOR_ARCHITEW6432
    } else {
      $env:PROCESSOR_ARCHITECTURE
    }
  }

  switch ($rawArch.ToLowerInvariant()) {
    { $_ -in @('x64', 'amd64') } { return 'windows-x64' }
    { $_ -in @('arm64', 'aarch64') } {
      throw 'Windows ARM64 release binaries are not published yet. Use WSL, or run from source with Bun.'
    }
    default {
      throw "Unsupported Windows architecture: $rawArch."
    }
  }
}

function Get-ManifestPlatform {
  param(
    [object]$Manifest,
    [string]$Platform
  )

  if (-not $Manifest.platforms) {
    return $null
  }

  $platformProperty = $Manifest.platforms.PSObject.Properties[$Platform]
  if (($null -eq $platformProperty) -and $Platform.StartsWith('windows-')) {
    $platformProperty = $Manifest.platforms.PSObject.Properties["$Platform.exe"]
  }
  if ($null -eq $platformProperty) {
    return $null
  }

  return $platformProperty.Value
}

function Normalize-PathEntry {
  param([string]$Entry)

  try {
    return [System.IO.Path]::GetFullPath($Entry).TrimEnd('\')
  } catch {
    return $Entry.TrimEnd('\')
  }
}

function Test-PathContainsDirectory {
  param(
    [string]$PathValue,
    [string]$Directory
  )

  if (-not $PathValue) {
    return $false
  }

  $target = Normalize-PathEntry $Directory
  foreach ($entry in $PathValue.Split(';', [System.StringSplitOptions]::RemoveEmptyEntries)) {
    if ((Normalize-PathEntry $entry) -ieq $target) {
      return $true
    }
  }

  return $false
}

function Add-ToUserPath {
  param([string]$Directory)

  if ($NoModifyPath -or (Test-PathContainsDirectory $env:Path $Directory)) {
    return
  }

  try {
    $userPath = [Environment]::GetEnvironmentVariable('Path', 'User')
    if (Test-PathContainsDirectory $userPath $Directory) {
      $env:Path = "$env:Path;$Directory"
      return
    }

    $newPath = if ($userPath) { "$userPath;$Directory" } else { $Directory }
    [Environment]::SetEnvironmentVariable('Path', $newPath, 'User')
    $env:Path = "$env:Path;$Directory"
    Write-Host "Added $Directory to the user PATH."
  } catch {
    Write-Warning "Could not update the user PATH. Add this directory manually: $Directory"
  }
}

function Install-Binary {
  param(
    [string]$Source,
    [string]$DestinationDirectory
  )

  New-Item -ItemType Directory -Force -Path $DestinationDirectory | Out-Null
  $destination = Join-Path $DestinationDirectory "$App.exe"
  $copyError = $null

  for ($attempt = 1; $attempt -le 10; $attempt += 1) {
    try {
      Copy-Item -LiteralPath $Source -Destination $destination -Force
      $copyError = $null
      break
    } catch {
      $copyError = $_
      if ($attempt -eq 10) {
        break
      }
      Start-Sleep -Milliseconds 250
    }
  }

  if ($copyError) {
    throw $copyError
  }

  if (Get-Command Unblock-File -ErrorAction SilentlyContinue) {
    Unblock-File -LiteralPath $destination -ErrorAction SilentlyContinue
  }

  Write-Host "Installed $App to $destination"
  return $destination
}

function Wait-ForProcessExit {
  param([int]$ProcessId)

  if ($ProcessId -le 0) {
    return
  }

  try {
    $process = Get-Process -Id $ProcessId -ErrorAction Stop
    Write-Host "Waiting for running Gambit process $ProcessId to exit before installing..."
    $process.WaitForExit()
  } catch {
  }
}

try {
  [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
} catch {
}

if ($Help) {
  Show-Usage
  return
}

$resolvedInstallDir = Resolve-InstallDir
$requestedVersion = Resolve-RequestedVersion

Wait-ForProcessExit $WaitForPid

try {
  if ($Binary) {
    if (-not (Test-Path -LiteralPath $Binary -PathType Leaf)) {
      throw "Binary not found: $Binary"
    }

    Install-Binary -Source $Binary -DestinationDirectory $resolvedInstallDir | Out-Null
    Add-ToUserPath $resolvedInstallDir
    Write-Host ''
    Write-Host "Run $App with: $App"
    return
  }

  $platform = Get-Platform
  $binaryName = "$App-$platform.exe"
  $releaseBase = "https://github.com/$Repo/releases"

  if ((-not $requestedVersion) -or $requestedVersion -eq 'stable' -or $requestedVersion -eq 'latest') {
    $manifestUrl = "$releaseBase/latest/download/manifest.json"
    $binaryUrl = "$releaseBase/latest/download/$binaryName"
    $versionLabel = 'latest'
  } else {
    $normalizedVersion = $requestedVersion.TrimStart('v')
    if ($normalizedVersion -notmatch '^[0-9]+\.[0-9]+\.[0-9]+(-[A-Za-z0-9._-]+)?$') {
      throw 'Version must look like 1.2.3, v1.2.3, or latest.'
    }
    $manifestUrl = "$releaseBase/download/v$normalizedVersion/manifest.json"
    $binaryUrl = "$releaseBase/download/v$normalizedVersion/$binaryName"
    $versionLabel = "v$normalizedVersion"
  }

  Write-Host "Installing $App ($versionLabel, $platform)"

  $manifestJson = Invoke-DownloadText $manifestUrl
  $manifest = $manifestJson | ConvertFrom-Json
  $specificVersion = $manifest.version
  $platformEntry = Get-ManifestPlatform -Manifest $manifest -Platform $platform
  $checksum = if ($platformEntry) { [string]$platformEntry.checksum } else { '' }

  if ((-not $checksum) -or ($checksum -notmatch '^[a-fA-F0-9]{64}$')) {
    throw "$platform is not available in the release manifest. See: $releaseBase"
  }

  $tmpDir = Join-Path ([System.IO.Path]::GetTempPath()) "gambit-install-$PID-$([guid]::NewGuid().ToString('N'))"
  New-Item -ItemType Directory -Force -Path $tmpDir | Out-Null

  try {
    $downloadPath = Join-Path $tmpDir $binaryName
    Invoke-DownloadFile -Url $binaryUrl -Output $downloadPath

    $actualChecksum = (Get-FileHash -LiteralPath $downloadPath -Algorithm SHA256).Hash.ToLowerInvariant()
    if ($actualChecksum -ne $checksum.ToLowerInvariant()) {
      throw "Checksum verification failed. Expected $checksum, got $actualChecksum."
    }

    Install-Binary -Source $downloadPath -DestinationDirectory $resolvedInstallDir | Out-Null
    Add-ToUserPath $resolvedInstallDir
  } finally {
    Remove-Item -LiteralPath $tmpDir -Recurse -Force -ErrorAction SilentlyContinue
  }

  Write-Host ''
  if ($specificVersion) {
    Write-Host "Gambit $specificVersion is installed."
  } else {
    Write-Host 'Gambit is installed.'
  }
  Write-Host "Run it with: $App"
} finally {
  if ($CleanupPath) {
    Remove-Item -LiteralPath $CleanupPath -Recurse -Force -ErrorAction SilentlyContinue
  }
}
