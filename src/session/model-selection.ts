import { mkdir } from 'node:fs/promises'
import path from 'node:path'

import { workspaceRoot } from '../config'
import { isReasoningEffort, normalizeProviderSlug, type ReasoningEffort } from '../lib/model'
import { isRecord } from './jsonl'
import { getModelSelectionPath } from './session-paths'

export interface PersistedModelSelection {
  modelId: string
  reasoningEffort: ReasoningEffort | null
  providerSlug: string | null
}

function parseReasoningEffort(value: unknown): ReasoningEffort | null {
  return isReasoningEffort(value) ? value : null
}

function parseModelSelection(value: unknown): PersistedModelSelection | null {
  if (!isRecord(value)) {
    return null
  }

  const { modelId, reasoningEffort, providerSlug } = value
  if (typeof modelId !== 'string' || !modelId.trim()) {
    return null
  }

  return {
    modelId: modelId.trim(),
    reasoningEffort: parseReasoningEffort(reasoningEffort),
    providerSlug: normalizeProviderSlug(providerSlug),
  }
}

export async function readModelSelection(root: string = workspaceRoot): Promise<PersistedModelSelection | null> {
  const filePath = getModelSelectionPath(root)

  try {
    return parseModelSelection(await Bun.file(filePath, { type: 'application/json' }).json())
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return null
    }
    if (error instanceof SyntaxError) {
      return null
    }
    throw error
  }
}

export async function writeModelSelection(
  selection: PersistedModelSelection,
  root: string = workspaceRoot,
): Promise<void> {
  const filePath = getModelSelectionPath(root)
  await mkdir(path.dirname(filePath), { recursive: true })
  await Bun.write(filePath, `${JSON.stringify(selection, null, 2)}\n`)
}
