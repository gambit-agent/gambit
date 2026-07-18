import { appendFile, mkdir } from 'node:fs/promises'
import path from 'node:path'

import { getTaskOutputPath } from '../session/session-paths'
import { getTask } from './task-store'

export interface TaskOutputTailResult {
  text: string
  truncated: boolean
}

async function resolveTaskOutputPath(taskId: string, fileName?: string): Promise<string> {
  const task = fileName ? null : await getTask(taskId)
  return task?.outputPath ?? getTaskOutputPath(taskId, fileName)
}

export async function readTaskOutput(taskId: string, fileName?: string): Promise<string> {
  const outputPath = await resolveTaskOutputPath(taskId, fileName)

  try {
    return await Bun.file(outputPath).text()
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return ''
    }
    throw error
  }
}

export async function readTaskOutputTail(taskId: string, maxBytes: number, fileName?: string): Promise<string> {
  const result = await readTaskOutputTailResult(taskId, maxBytes, fileName)
  return result.text
}

export async function readTaskOutputTailResult(
  taskId: string,
  maxBytes: number,
  fileName?: string,
): Promise<TaskOutputTailResult> {
  const outputPath = await resolveTaskOutputPath(taskId, fileName)
  const file = Bun.file(outputPath)
  if (!(await file.exists())) {
    return { text: '', truncated: false }
  }
  const size = file.size
  const start = Math.max(0, size - Math.max(0, maxBytes))
  return {
    text: await file.slice(start, size).text(),
    truncated: start > 0,
  }
}

export async function writeTaskOutput(taskId: string, content: string, fileName?: string): Promise<string> {
  const outputPath = getTaskOutputPath(taskId, fileName)
  await mkdir(path.dirname(outputPath), { recursive: true })
  await Bun.write(outputPath, content)
  return outputPath
}

export async function appendTaskOutput(taskId: string, content: string, fileName?: string): Promise<string> {
  const outputPath = getTaskOutputPath(taskId, fileName)
  await mkdir(path.dirname(outputPath), { recursive: true })
  await appendFile(outputPath, content, 'utf8')
  return outputPath
}
