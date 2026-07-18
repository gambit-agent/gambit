import { appendFile, chmod, mkdir } from 'node:fs/promises'
import { homedir } from 'node:os'
import path from 'node:path'

interface InstallOptions {
  target?: string
  installDir?: string
  noModifyPath: boolean
}

function parseInstallArgs(args: string[]): InstallOptions {
  const options: InstallOptions = { noModifyPath: false }
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index] ?? ''

    if (arg === '--no-modify-path') {
      options.noModifyPath = true
      continue
    }

    if (arg === '--install-dir') {
      const value = args[index + 1]
      if (value) {
        options.installDir = value
        index += 1
      }
      continue
    }

    if (!arg.startsWith('-')) {
      options.target = arg
    }
  }
  return options
}

function resolveBinDir(options: InstallOptions): string {
  if (options.installDir) {
    return options.installDir
  }
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

async function fileExists(filePath: string): Promise<boolean> {
  return Bun.file(filePath).exists()
}

async function addPathCommand(configFile: string, command: string, binDir: string): Promise<boolean> {
  const existing = await Bun.file(configFile).text().catch(() => '')
  if (existing.split(/\r?\n/).includes(command)) {
    console.log(`PATH entry already exists in ${configFile}`)
    return true
  }

  await appendFile(configFile, `\n# Gambit CLI\n${command}\n`, 'utf8')
  console.log(`Added ${binDir} to PATH in ${configFile}`)
  return true
}

async function configurePath(binDir: string, options: InstallOptions): Promise<void> {
  if (options.noModifyPath || isOnPath(binDir) || process.platform === 'win32') {
    return
  }

  const shellName = path.basename(process.env.SHELL ?? '')
  const xdgConfigHome = process.env.XDG_CONFIG_HOME ?? path.join(homedir(), '.config')
  let configFiles: string[]
  let command: string

  switch (shellName) {
    case 'fish':
      configFiles = [path.join(homedir(), '.config', 'fish', 'config.fish')]
      command = `fish_add_path "${binDir}"`
      break
    case 'zsh':
      configFiles = [
        path.join(process.env.ZDOTDIR ?? homedir(), '.zshrc'),
        path.join(process.env.ZDOTDIR ?? homedir(), '.zshenv'),
        path.join(xdgConfigHome, 'zsh', '.zshrc'),
        path.join(xdgConfigHome, 'zsh', '.zshenv'),
      ]
      command = `export PATH="${binDir}:$PATH"`
      break
    default:
      configFiles = [
        path.join(homedir(), '.bashrc'),
        path.join(homedir(), '.bash_profile'),
        path.join(homedir(), '.profile'),
        path.join(xdgConfigHome, 'bash', '.bashrc'),
        path.join(xdgConfigHome, 'bash', '.bash_profile'),
      ]
      command = `export PATH="${binDir}:$PATH"`
      break
  }

  for (const configFile of configFiles) {
    if (await fileExists(configFile)) {
      await addPathCommand(configFile, command, binDir)
      return
    }
  }

  console.log('')
  console.log(`${binDir} is not on your PATH. Add it with:`)
  console.log(`  ${command}`)
}

export async function runInstall(args: string[]): Promise<number> {
  const options = parseInstallArgs(args)
  const sourcePath = process.execPath

  if (!sourcePath) {
    console.error('Unable to determine the current executable path.')
    return 1
  }

  const binDir = resolveBinDir(options)
  const launcherName = process.platform === 'win32' ? 'gambit.exe' : 'gambit'
  const destination = path.join(binDir, launcherName)

  await mkdir(binDir, { recursive: true })
  await Bun.write(destination, Bun.file(sourcePath))
  await chmod(destination, 0o755)

  console.log(`Installed gambit to ${destination}`)
  if (options.target) {
    console.log(`Requested target: ${options.target}`)
  }

  await configurePath(binDir, options)

  if (!isOnPath(binDir)) {
    console.log('')
    if (options.noModifyPath || process.platform === 'win32') {
      console.log(`Note: ${binDir} is not on your PATH. Add it before running gambit globally.`)
      if (process.platform !== 'win32') {
        console.log(`  export PATH="${binDir}:$PATH"`)
      }
      console.log('')
    }
    if (process.platform === 'win32') {
      console.log('Then reload your terminal.')
    } else {
      console.log(`Then reload your shell or run:  export PATH="${binDir}:$PATH"`)
    }
  }

  return 0
}
