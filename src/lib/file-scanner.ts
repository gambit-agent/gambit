import path from 'node:path'
import { Glob } from 'bun'

export interface CollectFilesOptions {
  extensions?: ReadonlySet<string>
}

export async function collectFiles(directory: string, options: CollectFilesOptions = {}): Promise<string[]> {
  const files: string[] = []

  try {
    const glob = new Glob('**/*')
    for await (const filePath of glob.scan({
      cwd: directory,
      dot: true,
      absolute: true,
      onlyFiles: true,
      followSymlinks: false,
    })) {
      if (options.extensions && !options.extensions.has(path.extname(filePath))) {
        continue
      }
      files.push(filePath)
    }
  } catch {
    return []
  }

  return files.sort((left, right) => left.localeCompare(right))
}
