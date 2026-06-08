import { expect, test } from 'bun:test'
import { tmpdir } from 'node:os'
import path from 'node:path'

import {
  buildInstallerArgs,
  buildPowerShellInstallerArgs, buildWindowsUpdateScript,
  parseUpdateArgs,
  patchInstallerScript,
} from './update'

test('parses update defaults', () => {
  expect(parseUpdateArgs([])).toEqual({
    version: undefined,
    installDir: undefined,
    noModifyPath: false,
    help: false,
  })
  expect(buildInstallerArgs(parseUpdateArgs([]))).toEqual(['latest'])
})

test('parses positional and flag versions', () => {
  expect(parseUpdateArgs(['0.8.0']).version).toBe('0.8.0')
  expect(parseUpdateArgs(['--version', 'v0.8.0']).version).toBe('v0.8.0')
  expect(parseUpdateArgs(['-v', '0.8.1']).version).toBe('0.8.1')
})

test('passes install options through to the installer', () => {
  const options = parseUpdateArgs(['latest', '--install-dir', '/tmp/bin', '--no-modify-path'])
  expect(buildInstallerArgs(options)).toEqual(['latest', '--install-dir', '/tmp/bin', '--no-modify-path'])
})

test('passes install options through to the PowerShell installer', () => {
  const options = parseUpdateArgs(['latest', '--install-dir', 'C:\\Users\\me\\bin', '--no-modify-path'])
  expect(buildPowerShellInstallerArgs(options)).toEqual([
    '-Version',
    'latest',
    '-InstallDir',
    'C:\\Users\\me\\bin',
    '-NoModifyPath',
  ])
})

test('treats stable as the latest release alias', () => {
  expect(buildInstallerArgs(parseUpdateArgs(['stable']))).toEqual(['latest'])
  expect(buildPowerShellInstallerArgs(parseUpdateArgs(['stable']))).toEqual(['-Version', 'latest'])
})

test('rejects invalid update arguments', () => {
  expect(() => parseUpdateArgs(['--version'])).toThrow('--version requires a version argument.')
  expect(() => parseUpdateArgs(['--install-dir'])).toThrow('--install-dir requires a path argument.')
  expect(() => parseUpdateArgs(['--bad'])).toThrow('Unknown update option: --bad')
  expect(() => parseUpdateArgs(['0.8.0', '0.8.1'])).toThrow('Multiple versions provided')
})

test('patches installer cp to handle busy binary', () => {
  const original = `install_binary() {
  local source="$1"
  local destination="$INSTALL_DIR/$APP"

  mkdir -p "$INSTALL_DIR"
  cp "$source" "$destination"
  chmod 755 "$destination"
}`

  const patched = patchInstallerScript(original)
  expect(patched).toContain('if cp "$source" "$destination" 2>/dev/null; then')
  expect(patched).toContain('mv -f "$tmp_dest" "$destination"')
  expect(patched).not.toContain('\n  cp "$source" "$destination"\n')
})

test('patchInstallerScript warns on unknown installer', () => {
  const result = patchInstallerScript('some random script')
  expect(result).toBe('some random script')
})

test('buildWindowsUpdateScript generates valid PowerShell with default settings', () => {
  const pid = 12345
  const cleanupPath = path.join(tmpdir(), 'gambit-test-cleanup')
  const script = buildWindowsUpdateScript(pid, cleanupPath, 'gambit-agent/gambit', 'latest', '', false)

  expect(script).toContain('param()')
  expect(script).toContain('$ErrorActionPreference')
  expect(script).toContain('function Wait-ForProcessExit')
  expect(script).toContain(`Wait-ForProcessExit ${pid}`)
  expect(script).toContain('function Resolve-InstallDir')
  expect(script).toContain('$env:GAMBIT_BIN_DIR')
  expect(script).toContain("Join-Path $HOME '.local\\bin'")
  expect(script).toContain('function Add-ToUserPath')
  expect(script).toContain('function Install-Binary')
  expect(script).toContain('Copy-Item -LiteralPath')
  expect(script).toContain('Get-FileHash -LiteralPath')
  expect(script).toContain('Remove-Item -LiteralPath')
  expect(script).toContain(cleanupPath)
  expect(script).toContain('github.com/gambit-agent/gambit/releases')
  expect(script).toContain('gambit-$platform.exe')

  // Verify no JS template syntax leaked into output
  expect(script).not.toMatch(/\$\{[a-zA-Z]/)
})

test('buildWindowsUpdateScript with specific version and install dir', () => {
  const script = buildWindowsUpdateScript(
    999,
    'C:\\Windows\\Temp\\gambit-upd',
    'custom/repo',
    'v0.8.0',
    'C:\\Users\\me\\.local\\bin',
    false,
  )

  expect(script).toContain('v0.8.0')
  expect(script).toContain('C:\\Users\\me\\.local\\bin')
  expect(script).toContain('custom/repo')
  expect(script).toContain('Wait-ForProcessExit 999')
})

test('buildWindowsUpdateScript with noModifyPath skips PATH modification', () => {
  const script = buildWindowsUpdateScript(0, '/tmp/c', 'repo/foo', 'latest', '', true)

  // Add-ToUserPath should just return immediately
  const addToUserPathIndex = script.indexOf('function Add-ToUserPath')
  const addToUserPathEnd = script.indexOf('function Install-Binary')
  const addToUserPathSection = script.slice(addToUserPathIndex, addToUserPathEnd)

  // With noModifyPath=true, the function body should be just 'return'
  expect(addToUserPathSection).not.toContain('SetEnvironmentVariable')
  expect(addToUserPathSection).not.toContain('Test-PathContainsDirectory $env:Path')
})

test('buildWindowsUpdateScript does not leak JS template syntax', () => {
  // Generate with various parameter combinations to ensure no leaks
  for (const version of ['latest', 'stable', 'v1.2.3', '0.8.0']) {
    const script = buildWindowsUpdateScript(100, '/tmp/x', 'r/o', version, '', false)
    expect(script).not.toMatch(/\$\{[a-zA-Z]/)
  }
})
