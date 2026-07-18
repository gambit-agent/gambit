import { expect, test } from 'bun:test'

import { ATIF_SCHEMA_VERSION, type AtifTrajectory } from './atif-types'
import { validateAtifTrajectory } from './atif-validator'

test('accepts a valid ATIF trajectory with tool observations and subagent refs', () => {
  const trajectory: AtifTrajectory = {
    schema_version: ATIF_SCHEMA_VERSION,
    trajectory_id: 'parent',
    agent: { name: 'gambit', version: 'test' },
    steps: [
      {
        step_id: 1,
        source: 'agent',
        message: '',
        tool_calls: [
          {
            tool_call_id: 'call-1',
            function_name: 'spawnAgent',
            arguments: { prompt: 'inspect' },
          },
        ],
        observation: {
          results: [
            {
              source_call_id: 'call-1',
              content: 'done',
              subagent_trajectory_ref: [
                {
                  trajectory_id: 'child',
                  trajectory_path: '.gambit/agents/child/trajectory.json',
                },
              ],
            },
          ],
        },
      },
    ],
  }

  expect(validateAtifTrajectory(trajectory)).toEqual([])
})

test('rejects non-sequential steps and unresolved references', () => {
  const trajectory: AtifTrajectory = {
    schema_version: ATIF_SCHEMA_VERSION,
    agent: { name: 'gambit', version: 'test' },
    steps: [
      {
        step_id: 2,
        source: 'agent',
        message: '',
        observation: {
          results: [
            {
              source_call_id: 'missing-call',
              subagent_trajectory_ref: [{}],
            },
          ],
        },
      },
    ],
  }

  const issues = validateAtifTrajectory(trajectory)
  expect(issues.map((issue) => issue.path)).toContain('$.steps[0].step_id')
  expect(issues.map((issue) => issue.path)).toContain('$.steps[0].observation.results[0].source_call_id')
  expect(issues.map((issue) => issue.path)).toContain('$.steps[0].observation.results[0].subagent_trajectory_ref[0]')
})
