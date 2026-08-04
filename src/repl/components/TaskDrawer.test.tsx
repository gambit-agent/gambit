import { afterEach, expect, test } from 'bun:test'
import { testRender } from '@opentui/react/test-utils'
import { act } from 'react'

import type { TaskRecord } from '../../tasks/task-types'
import { TaskDrawer } from './TaskDrawer'

let testSetup: Awaited<ReturnType<typeof testRender>> | null = null

afterEach(async () => {
  await act(async () => {
    testSetup?.renderer.destroy()
  })
  testSetup = null
})

function task(id: string, title: string, status: TaskRecord['status']): TaskRecord {
  return {
    id,
    kind: 'shell',
    title,
    status,
    background: true,
    createdAt: '2026-08-04T12:00:00.000Z',
    startedAt: '2026-08-04T12:00:00.000Z',
    progressSummary: status === 'running' ? '184 / 260 tests' : undefined,
  }
}

test('renders the framed command-center layout with status filters and task actions', async () => {
  testSetup = await testRender(
    <TaskDrawer
      activeTasks={[
        task('task-running', 'Run full test suite', 'running'),
        task('task-queued', 'Build release binary', 'pending'),
      ]}
      recentTasks={[task('task-done', 'Generate changelog', 'completed')]}
      selectedTaskIndex={0}
      filter="all"
      focus="list"
      detailMode="live"
      goal="Ship the release candidate with verified tests"
      terminalWidth={120}
      terminalHeight={40}
      onFilterChange={() => undefined}
      onDetailModeChange={() => undefined}
      onClose={() => undefined}
    />,
    { width: 120, height: 40 },
  )

  await testSetup.renderOnce()
  const frame = testSetup.captureCharFrame()

  expect(frame).toContain('BACKGROUND TASKS')
  expect(frame).toContain('1 running  ·  1 queued  ·  1 finished')
  expect(frame).toContain('GOAL  Ship the release candidate with verified tests')
  expect(frame).toContain('RUNNING 1')
  expect(frame).toContain('QUEUED 1')
  expect(frame).toContain('DONE 1')
  expect(frame).toContain('Run full test suite')
  expect(frame).toContain('LIVE OUTPUT')
  expect(frame).toContain('F filter')
  expect(frame).toContain('C cancel')
})

test('renders only finished tasks when the done filter is active', async () => {
  testSetup = await testRender(
    <TaskDrawer
      activeTasks={[task('task-running', 'Run full test suite', 'running')]}
      recentTasks={[task('task-done', 'Generate changelog', 'completed')]}
      selectedTaskIndex={0}
      filter="done"
      focus="list"
      detailMode="details"
      goal={null}
      terminalWidth={100}
      terminalHeight={32}
      onFilterChange={() => undefined}
      onDetailModeChange={() => undefined}
      onClose={() => undefined}
    />,
    { width: 100, height: 32 },
  )

  await testSetup.renderOnce()
  const frame = testSetup.captureCharFrame()

  expect(frame).toContain('Generate changelog')
  expect(frame).not.toContain('Run full test suite')
  expect(frame).toContain('TASK RECORD')
})
