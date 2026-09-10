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

  test('preserves JSON values and recovers after malformed lines and rejected transforms', async () => {
    root = await mkdtemp(path.join(os.tmpdir(), 'gambit-jsonl-'))
    const filePath = path.join(root, 'records.jsonl')
    await writeFile(filePath, [
      '  {"text":"escaped\\nnewline and café"}  ',
      '',
      'not-json',
      'null',
      'false',
      '42',
      '[1,2]',
      '"skip"',
      '"throw"',
      '{"last":true}',
    ].join('\r\n'), 'utf8')
    const entries = await readJsonlEntries(filePath, (value) => {
      if (value === 'throw') throw new Error('Rejected record')
      return value === 'skip' ? null : { value }
    })
    expect(entries).toEqual([
      { value: { text: 'escaped\nnewline and café' } },
      { value: null },
      { value: false },
      { value: 42 },
      { value: [1, 2] },
      { value: { last: true } },
    ])
  })
})
