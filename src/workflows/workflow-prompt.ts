export function buildWorkflowRunPrompt(task: string): string {
  const normalizedTask = task.trim().replace(/\s+/g, ' ')
  if (!normalizedTask) {
    throw new Error('Workflow task must not be empty.')
  }

  return [
    `Workflow task: ${normalizedTask}`,
    'Create and run a dynamic workflow for this task using the workflow tool.',
    'Write a deterministic JavaScript workflow tailored to the task. Use phase(title), agent(prompt, options), parallel(thunks), and pipeline(items, ...stages) where they fit.',
    'Reuse Gambit subagents through agent() for focused research, implementation, review, or synthesis work. Include enough task context in each subagent prompt.',
    'Return a compact final synthesis with the result, important evidence, and any remaining caveats.',
  ].join('\n\n')
}

export function buildWorkflowEditPrompt(previousScript: string, change: string): string {
  const normalizedScript = previousScript.trim()
  const normalizedChange = change.trim().replace(/\s+/g, ' ')
  if (!normalizedScript) {
    throw new Error('Previous workflow script must not be empty.')
  }
  if (!normalizedChange) {
    throw new Error('Workflow edit request must not be empty.')
  }

  return [
    `Workflow edit request: ${normalizedChange}`,
    'Revise the previous dynamic workflow script and run the revised workflow with the workflow tool.',
    'Keep the script deterministic and tailored to the requested change. Preserve useful phases, agents, and synthesis behavior unless the change asks otherwise.',
    'Previous workflow script:',
    '```javascript',
    normalizedScript,
    '```',
  ].join('\n\n')
}
