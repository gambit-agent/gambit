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

function task(overrides: Partial<TaskRecord> & Pick<TaskRecord, 'id' | 'title' | 'status'>): TaskRecord {
  return {
    kind: 'agent',
    background: true,
    createdAt: '2026-08-04T12:00:00.000Z',
    ...overrides,
  }
}

test('renders the command-center hierarchy at wide terminal sizes', async () => {
  const activeTask = task({
    id: 'task-running',
    title: 'Review permission boundaries',
    status: 'running',
    progressSummary: 'Inspecting project plugin trust.',
    metadata: { agentRole: 'security reviewer' },
  })
  const recentTask = task({
    id: 'task-done',
    title: 'Normalize ripgrep output',
    status: 'completed',
    kind: 'shell',
  })

  testSetup = await testRender(
    <TaskDrawer
      activeTasks={[activeTask]}
      recentTasks={[recentTask]}
      selectedTaskIndex={0}
      filter="all"
      focusPane="list"
      detailTab="activity"
      goal="Ship Gambit with a reliable task lifecycle"
      terminalWidth={130}
      terminalHeight={42}
      onClose={() => {}}
    />,
    { width: 130, height: 42 },
  )

  await act(async () => {
    await testSetup!.renderOnce()
    await Bun.sleep(10)
    await testSetup!.renderOnce()
  })
  const frame = testSetup.captureCharFrame()

  expect(frame).toContain('Background tasks')
  expect(frame).toContain('Live workspace activity')
  expect(frame).toContain('1 RUNNING')
  expect(frame).toContain('1 RECENT')
  expect(frame).toContain('ACTIVE GOAL')
  expect(frame).toContain('ALL 2')
  expect(frame).toContain('Review permission boundaries')
  expect(frame).toContain('Normalize ripgrep output')
  expect(frame).toContain('LIVE ACTIVITY')
})

test('history filter excludes active rows and renders the output view', async () => {
  const activeTask = task({ id: 'task-running', title: 'Active task', status: 'running' })
  const recentTask = task({ id: 'task-done', title: 'Finished task', status: 'completed' })

  testSetup = await testRender(
    <TaskDrawer
      activeTasks={[activeTask]}
      recentTasks={[recentTask]}
      selectedTaskIndex={0}
      filter="history"
      focusPane="detail"
      detailTab="output"
      goal={null}
      terminalWidth={110}
      terminalHeight={36}
      onClose={() => {}}
    />,
    { width: 110, height: 36 },
  )

  await act(async () => {
    await testSetup!.renderOnce()
    await Bun.sleep(10)
    await testSetup!.renderOnce()
  })
  const frame = testSetup.captureCharFrame()

  expect(frame).toContain('HISTORY 1')
  expect(frame).toContain('Finished task')
  expect(frame).not.toContain('Active task')
  expect(frame).toContain('OUTPUT TAIL')
})

test('stacks list and detail panes in a narrow terminal', async () => {
  const activeTask = task({
    id: 'task-narrow',
    title: 'Narrow terminal task',
    status: 'pending',
    kind: 'workflow',
  })

  testSetup = await testRender(
    <TaskDrawer
      activeTasks={[activeTask]}
      recentTasks={[]}
      selectedTaskIndex={0}
      filter="active"
      focusPane="list"
      detailTab="details"
      goal={null}
      terminalWidth={64}
      terminalHeight={30}
      onClose={() => {}}
    />,
    { width: 64, height: 30 },
  )

  await act(async () => {
    await testSetup!.renderOnce()
    await Bun.sleep(10)
    await testSetup!.renderOnce()
  })
  const frame = testSetup.captureCharFrame()

  expect(frame).toContain('Background tasks')
  expect(frame).toContain('Narrow terminal task')
  expect(frame).toContain('TASK DETAILS')
  expect(frame).toContain('Ctrl+B/Esc')
})
