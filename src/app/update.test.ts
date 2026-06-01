import { expect, test } from 'bun:test'

import {
  buildInstallerArgs,
  buildPowerShellInstallerArgs,
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
