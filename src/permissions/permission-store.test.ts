import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { mkdtemp, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

import { setWorkspaceRootForTesting } from '../config'
import { enqueuePermissionRequest, dequeuePermissionRequest, listPermissionRequests, resolvePermissionRequest } from './permission-store'

describe('permission store', () => {
  let root = ''

  beforeEach(async () => {
    root = await mkdtemp(path.join(os.tmpdir(), 'gambit-permission-store-'))
    setWorkspaceRootForTesting(root)
  })

  test('enqueues, dequeues, and resolves permission requests', async () => {
    const request = await enqueuePermissionRequest({
      subject: 'Run shell command',
    })

    const queued = await listPermissionRequests()
    expect(queued).toHaveLength(1)
    expect(queued[0]?.decision).toBe('ask')
    expect(queued[0]?.state).toBe('queued')

    const dequeued = await dequeuePermissionRequest()
    expect(dequeued?.id).toBe(request.id)
    expect(dequeued?.state).toBe('dequeued')

    const resolved = await resolvePermissionRequest(request.id, { decision: 'allow' })
    expect(resolved?.decision).toBe('allow')
    expect(resolved?.state).toBe('resolved')

    const allRequests = await listPermissionRequests()
    expect(allRequests[0]?.state).toBe('resolved')
  })

  test('does not lose records under concurrent enqueues and resolves', async () => {
    const total = 25

    await Promise.all(
      Array.from({ length: total }, async (_, index) => {
        const record = await enqueuePermissionRequest({ subject: `concurrent request ${index}` })
        const resolved = await resolvePermissionRequest(record.id, { decision: 'allow' })
        expect(resolved?.id).toBe(record.id)
      }),
    )

    const records = await listPermissionRequests()
    expect(records).toHaveLength(total)
    expect(records.every((record) => record.state === 'resolved')).toBe(true)
    expect(records.every((record) => record.decision === 'allow')).toBe(true)
    expect(new Set(records.map((record) => record.subject)).size).toBe(total)
  })

  test('rejects empty permission subjects', async () => {
    await expect(
      enqueuePermissionRequest({
        subject: '   ',
      }),
    ).rejects.toThrow('Permission request subject must not be empty.')
  })

  afterEach(async () => {
    await rm(root, { recursive: true, force: true })
  })
})
