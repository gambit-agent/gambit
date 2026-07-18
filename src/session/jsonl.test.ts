import { afterEach, describe, expect, test } from 'bun:test'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

import { appendJsonlEntry, readJsonlEntries, readJsonlTailEntries, writeJsonlEntries } from './jsonl'

describe('jsonl helpers', () => {
  let root = ''

  afterEach(async () => {
    if (!root) {
      return
    }
    await rm(root, { recursive: true, force: true })
  })

  test('writes and reads structured entries', async () => {
    root = await mkdtemp(path.join(os.tmpdir(), 'gambit-jsonl-'))
    const filePath = path.join(root, 'records.jsonl')

    await writeJsonlEntries(filePath, [{ id: 1 }, { id: 2 }])
    await appendJsonlEntry(filePath, { id: 3 })
    await writeFile(filePath, `${await Bun.file(filePath).text()}not-json\n`, 'utf8')

    const entries = await readJsonlEntries(filePath, (value) => {
      if (typeof value === 'object' && value !== null && 'id' in value) {
        const candidate = value as { id?: unknown }
        if (typeof candidate.id === 'number') {
          return candidate.id
        }
      }
      return null
    })

    expect(entries).toEqual([1, 2, 3])
  })

  test('reads only the requested JSONL tail entries', async () => {
    root = await mkdtemp(path.join(os.tmpdir(), 'gambit-jsonl-'))
    const filePath = path.join(root, 'records.jsonl')
    await writeJsonlEntries(filePath, Array.from({ length: 20 }, (_, index) => ({ id: index + 1 })))

    const entries = await readJsonlTailEntries(filePath, 3, (value) => {
      if (typeof value === 'object' && value !== null && 'id' in value) {
        const candidate = value as { id?: unknown }
        return typeof candidate.id === 'number' ? candidate.id : null
      }
      return null
    })

    expect(entries).toEqual([18, 19, 20])
  })
})
