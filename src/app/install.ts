import { chmod, copyFile, mkdir } from 'node:fs/promises'
import { homedir } from 'node:os'
import path from 'node:path'

export interface InstallOptions {
  target?: string
}

function parseInstallArgs(args: string[]): InstallOptions {
  const options: InstallOptions = {}
  for (const arg of args) {
    if (!arg.startsWith('-')) {
      options.target = arg
    }
  }
  return options
}

function resolveBinDir(): string {
  if (process.env.GAMBIT_BIN_DIR) {
    return process.env.GAMBIT_BIN_DIR
  }
  const xdgBin = process.env.XDG_BIN_HOME
  if (xdgBin) return xdgBin
  return path.join(homedir(), '.local', 'bin')
}

function isOnPath(dir: string): boolean {
  const rawPath = process.env.PATH ?? ''
  const separator = process.platform === 'win32' ? ';' : ':'
  return rawPath.split(separator).some((entry) => path.resolve(entry) === path.resolve(dir))
}

export async function runInstall(args: string[]): Promise<number> {
  const options = parseInstallArgs(args)
  const sourcePath = process.execPath

  if (!sourcePath) {
    console.error('Unable to determine the current executable path.')
    return 1
  }

  const binDir = resolveBinDir()
  const launcherName = process.platform === 'win32' ? 'gambit.exe' : 'gambit'
  const destination = path.join(binDir, launcherName)

  await mkdir(binDir, { recursive: true })
  await copyFile(sourcePath, destination)
  await chmod(destination, 0o755)

  console.log(`Installed gambit to ${destination}`)
  if (options.target) {
    console.log(`Requested target: ${options.target}`)
  }

  if (!isOnPath(binDir)) {
    console.log('')
    console.log(`Note: ${binDir} is not on your PATH. Add it with:`)
    console.log(`  echo 'export PATH="${binDir}:$PATH"' >> ~/.bashrc   # or ~/.zshrc`)
    console.log('')
    console.log(`Then reload your shell or run:  export PATH="${binDir}:$PATH"`)
  }

  return 0
}
