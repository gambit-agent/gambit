function toPosix(value: string): string {
  return value.replace(/\\/g, '/')
}

function splitLines(text: string): string[] {
  const normalized = text.replace(/\r\n?/g, '\n')
  const lines = normalized.split('\n')
  if (lines.length > 0 && lines[lines.length - 1] === '') {
    lines.pop()
  }
  return lines
}

function diffLines(oldLines: readonly string[], newLines: readonly string[]): string[] {
  const rows = oldLines.length + 1
  const columns = newLines.length + 1
  const table: number[][] = Array.from({ length: rows }, () => Array.from({ length: columns }, () => 0))

  for (let oldIndex = oldLines.length - 1; oldIndex >= 0; oldIndex -= 1) {
    for (let newIndex = newLines.length - 1; newIndex >= 0; newIndex -= 1) {
      table[oldIndex]![newIndex] =
        oldLines[oldIndex] === newLines[newIndex]
          ? (table[oldIndex + 1]?.[newIndex + 1] ?? 0) + 1
          : Math.max(table[oldIndex + 1]?.[newIndex] ?? 0, table[oldIndex]?.[newIndex + 1] ?? 0)
    }
  }

  const result: string[] = []
  let oldIndex = 0
  let newIndex = 0

  while (oldIndex < oldLines.length || newIndex < newLines.length) {
    if (oldIndex < oldLines.length && newIndex < newLines.length && oldLines[oldIndex] === newLines[newIndex]) {
      result.push(` ${oldLines[oldIndex]}`)
      oldIndex += 1
      newIndex += 1
    } else if (
      newIndex < newLines.length &&
      (oldIndex >= oldLines.length || (table[oldIndex]?.[newIndex + 1] ?? 0) >= (table[oldIndex + 1]?.[newIndex] ?? 0))
    ) {
      result.push(`+${newLines[newIndex]}`)
      newIndex += 1
    } else if (oldIndex < oldLines.length) {
      result.push(`-${oldLines[oldIndex]}`)
      oldIndex += 1
    }
  }

  return result
}

export function createUnifiedDiff(options: {
  oldPath: string | null
  newPath: string | null
  oldText: string
  newText: string
}): string {
  const oldLines = splitLines(options.oldText)
  const newLines = splitLines(options.newText)
  const hasChanges = oldLines.length !== newLines.length || oldLines.some((line, index) => line !== newLines[index])

  if (!hasChanges) {
    return ''
  }

  const oldPath = options.oldPath ? toPosix(options.oldPath) : '/dev/null'
  const newPath = options.newPath ? toPosix(options.newPath) : '/dev/null'
  const oldHeaderPath = options.oldPath ? `a/${oldPath}` : '/dev/null'
  const newHeaderPath = options.newPath ? `b/${newPath}` : '/dev/null'
  const oldCount = oldLines.length
  const newCount = newLines.length
  const oldRange = oldCount === 0 ? '0,0' : `1,${oldCount}`
  const newRange = newCount === 0 ? '0,0' : `1,${newCount}`
  const headerName = options.newPath ?? options.oldPath ?? 'file'

  return [
    `diff --git a/${toPosix(headerName)} b/${toPosix(headerName)}`,
    `--- ${oldHeaderPath}`,
    `+++ ${newHeaderPath}`,
    `@@ -${oldRange} +${newRange} @@`,
    ...diffLines(oldLines, newLines),
    '',
  ].join('\n')
}

export function inferFiletype(filePath: string | null | undefined): string | undefined {
  const extension = filePath?.split('.').pop()?.toLowerCase()
  switch (extension) {
    case 'ts':
    case 'tsx':
      return 'typescript'
    case 'js':
    case 'jsx':
    case 'mjs':
    case 'cjs':
      return 'javascript'
    case 'json':
      return 'json'
    case 'md':
    case 'markdown':
      return 'markdown'
    case 'py':
      return 'python'
    case 'rs':
      return 'rust'
    case 'go':
      return 'go'
    case 'html':
      return 'html'
    case 'css':
      return 'css'
    case 'sh':
    case 'bash':
      return 'bash'
    default:
      return extension
  }
}
