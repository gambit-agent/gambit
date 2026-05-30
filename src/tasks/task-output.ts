import { mkdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'

import { getTaskOutputPath } from '../session/session-paths'
import { getTask } from './task-store'

export async function readTaskOutput(taskId: string, fileName?: string): Promise<string> {
  const task = fileName ? null : await getTask(taskId)
  const outputPath = task?.outputPath ?? getTaskOutputPath(taskId, fileName)

  try {
    return await readFile(outputPath, 'utf8')
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return ''
    }
    throw error
  }
}

export async function writeTaskOutput(taskId: string, content: string, fileName?: string): Promise<string> {
  const outputPath = getTaskOutputPath(taskId, fileName)
  await mkdir(path.dirname(outputPath), { recursive: true })
  await writeFile(outputPath, content, 'utf8')
  return outputPath
}

export async function appendTaskOutput(taskId: string, content: string, fileName?: string): Promise<string> {
  const outputPath = getTaskOutputPath(taskId, fileName)
  const current = await readTaskOutput(taskId, fileName)
  await writeTaskOutput(taskId, `${current}${content}`, fileName)
  return outputPath
}
