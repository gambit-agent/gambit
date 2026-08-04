import { afterEach, expect, test } from 'bun:test'
import { act } from 'react'
import { testRender } from '@opentui/react/test-utils'

import type { TaskRecord, TaskStatus } from '../../tasks/task-types'
import type { WorkflowSnapshot } from '../../workflows/workflow-display'
import { TaskDrawer } from './TaskDrawer'

let testSetup: Awaited<ReturnType<typeof testRender>> | null = null

afterEach(() => {
  testSetup?.renderer.destroy()
  testSetup = null
})

function createTask(overrides: Partial<TaskRecord> & { id: string; status: TaskStatus }): TaskRecord {
  return {
    kind: 'agent',
    title: `task ${overrides.id}`,
    background: true,
    createdAt: '2026-08-04T12:00:00.000Z',
    ...overrides,
  }
}

function createWorkflowTask(): TaskRecord {
  const snapshot: WorkflowSnapshot = {
    name: 'refactor-auth-module',
    phases: ['scan', 'rewrite'],
    currentPhase: 'rewrite',
    logs: [],
    agents: [
      { id: 4, label: 'map token call-sites', phase: 'scan', prompt: '', status: 'done' },
      { id: 7, label: 'auth/middleware.ts', phase: 'rewrite', prompt: '', status: 'done' },
      { id: 8, label: 'auth/session.ts', phase: 'rewrite', prompt: '', status: 'running' },
    ],
    agentCount: 3,
    runningCount: 1,
    doneCount: 2,
    errorCount: 0,
  }

  return createTask({
    id: 'wf_8c21a4',
    status: 'running',
    kind: 'workflow',
    title: 'refactor-auth-module',
    startedAt: '2026-08-04T12:00:00.000Z',
    metadata: { workflowSnapshot: snapshot },
  })
}

async function renderDrawer(
  props: Partial<Parameters<typeof TaskDrawer>[0]> = {},
): Promise<string> {
  testSetup = await testRender(
    <TaskDrawer
      activeTasks={[]}
      recentTasks={[]}
      selectedTaskIndex={0}
      goal={null}
      filter="all"
      searchQuery=""
      searchActive={false}
      detailFocused={false}
      outputExpanded={false}
      terminalWidth={130}
      terminalHeight={40}
      onSearchChange={() => {}}
      onClose={() => {}}
      {...props}
    />,
    { width: 130, height: 40 },
  )

  const setup = testSetup
  // act() keeps the drawer's mount-time state updates inside the render pass.
  await act(async () => {
    await setup.renderOnce()
  })
  return setup.captureCharFrame()
}

test('renders the panel frame, live counters, filter tabs, and footer verbs', async () => {
  const frame = await renderDrawer({
    activeTasks: [createTask({ id: 'a', status: 'running', startedAt: '2026-08-04T12:00:00.000Z' })],
    recentTasks: [createTask({ id: 'b', status: 'completed' })],
  })

  expect(frame).toContain('ACTIVITY')
  expect(frame).toContain('running')
  expect(frame).toContain('queued')
  expect(frame).toContain('ACTIVE')
  expect(frame).toContain('RECENT')
  expect(frame).toContain('move')
  expect(frame).toContain('filter')
  expect(frame).toContain('search')
  expect(frame).toContain('close')
})

test('shows the kill verb for an in-flight selection and hides it for a finished one', async () => {
  const running = await renderDrawer({
    activeTasks: [createTask({ id: 'a', status: 'running', startedAt: '2026-08-04T12:00:00.000Z' })],
    selectedTaskIndex: 0,
  })
  expect(running).toContain('kill task')

  const finished = await renderDrawer({
    recentTasks: [createTask({ id: 'b', status: 'completed' })],
    selectedTaskIndex: 0,
  })
  expect(finished).not.toContain('kill task')
})

test('renders workflow progress, phases, and subagents for the selected task', async () => {
  const frame = await renderDrawer({
    activeTasks: [createWorkflowTask()],
    selectedTaskIndex: 0,
  })

  expect(frame).toContain('PROGRESS')
  expect(frame).toContain('PHASES')
  expect(frame).toContain('SUBAGENTS')
  expect(frame).toContain('2/3 agents')
  expect(frame).toContain('1 running')
  expect(frame).toContain('█')
  expect(frame).toContain('RUNNING')
})

test('filter tabs narrow the list and the empty state explains why', async () => {
  const frame = await renderDrawer({
    recentTasks: [createTask({ id: 'b', status: 'completed', title: 'docs rewrite' })],
    filter: 'failed',
  })

  expect(frame).toContain('No task matches this filter')
  expect(frame).not.toContain('docs rewrite')
})

test('explains what the panel is for when no task has ever run', async () => {
  const frame = await renderDrawer()
  expect(frame).toContain('No background tasks yet')
  expect(frame).toContain('Background work shows up here')
})

test('renders the search field when search is active', async () => {
  const frame = await renderDrawer({
    recentTasks: [createTask({ id: 'b', status: 'completed', title: 'docs rewrite' })],
    searchActive: true,
    searchQuery: 'docs',
  })

  expect(frame).toContain('docs')
})

test('search narrows the rendered rows', async () => {
  const frame = await renderDrawer({
    recentTasks: [
      createTask({ id: 'b', status: 'completed', title: 'docs rewrite' }),
      createTask({ id: 'c', status: 'completed', title: 'bench tokens' }),
    ],
    searchQuery: 'docs',
  })

  expect(frame).toContain('docs rewrite')
  expect(frame).not.toContain('bench tokens')
})

test('shows the goal in the list pane when one is set', async () => {
  const frame = await renderDrawer({ goal: 'ship the auth refactor' })

  expect(frame).toContain('GOAL')
  expect(frame).toContain('ship the auth refactor')
})
