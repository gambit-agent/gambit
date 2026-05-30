$ErrorActionPreference = "Stop"

# Source checkout bootstrap. For released binaries, prefer the Bash installer
# from WSL or install from a GitHub release asset.

Set-Location $PSScriptRoot

if (-not (Get-Command bun -ErrorAction SilentlyContinue)) {
  Write-Error "Bun is required. Install it from https://bun.sh, then rerun setup.ps1."
  exit 1
}

bun install
bun run tsc --noEmit
bun build --compile --outfile=gambit.exe src/gambit.tsx

$binDir = if ($env:GAMBIT_BIN_DIR) { $env:GAMBIT_BIN_DIR } else { Join-Path $HOME ".local\bin" }
New-Item -ItemType Directory -Force -Path $binDir | Out-Null
Copy-Item -Force ".\gambit.exe" (Join-Path $binDir "gambit.exe")

Write-Host ""
Write-Host "Installed gambit.exe to $binDir"
if (($env:Path -split ";") -notcontains $binDir) {
  Write-Host "Add this directory to PATH before running gambit from a new terminal:"
  Write-Host "  $binDir"
}
