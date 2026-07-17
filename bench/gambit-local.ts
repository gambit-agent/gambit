#!/usr/bin/env bun

import { mkdir, mkdtemp, readdir, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

import { appendTruncationNotice, collectBoundedText } from '../src/lib/process-output'

type JsonValue =
  | string
  | number
  | boolean
  | null
  | JsonValue[]
  | { [key: string]: JsonValue }

interface CommandResult {
  exitCode: number
  stdout: string
  stderr: string
  durationMs: number
  timedOut: boolean
}

interface BenchOptions {
  agentCommand: string[]
  all: boolean
  keep: boolean
  model?: string
  outDir: string
  taskIds: string[]
  timeoutMs: number
}

interface BenchTask {
  id: string
  name: string
  description: string
  prompt: string
  setup: (workspace: string) => Promise<void>
  validate: (workspace: string) => Promise<CommandResult>
}

interface BenchResult {
  id: string
  name: string
  passed: boolean
  workspace: string
  durationMs: number
  agentExitCode: number
  agentTimedOut: boolean
  validatorExitCode: number
  validatorTimedOut: boolean
  toolUses: number
  toolResults: number
  model: string | null
  result: string
  error: string | null
}

const repoRoot = path.resolve(import.meta.dir, '..')
const defaultOutDir = path.join(os.tmpdir(), 'gambit-bench')
const commandOutputLimitChars = 1_000_000

const taskPrompt = [
  'You are running inside an isolated coding benchmark workspace.',
  'Fix the project so the validation command passes.',
  'Use the available tools to inspect files, edit code, and run tests.',
  'Do not ask questions. When finished, briefly summarize what changed.',
].join('\n')

const tasks: BenchTask[] = [
  {
    id: 'ts-unit-fix',
    name: 'TypeScript unit test repair',
    description: 'Fix small TypeScript logic bugs until bun test passes.',
    prompt: taskPrompt,
    setup: async (workspace) => {
      await writeFiles(workspace, {
        'package.json': JSON.stringify({
          name: 'gambit-bench-ts-unit-fix',
          type: 'module',
          scripts: { test: 'bun test' },
        }, null, 2),
        'src/math.ts': [
          'export function clamp(value: number, min: number, max: number): number {',
          '  if (value < min) return max',
          '  if (value > max) return min',
          '  return value',
          '}',
          '',
          'export function average(values: number[]): number {',
          '  return values.reduce((total, value) => total + value, 0)',
          '}',
          '',
          'export function isPrime(value: number): boolean {',
          '  if (value <= 1) return true',
          '  for (let divisor = 2; divisor < value; divisor += 1) {',
          '    if (value % divisor === 0) return false',
          '  }',
          '  return true',
          '}',
          '',
        ].join('\n'),
        'src/math.test.ts': [
          "import { describe, expect, test } from 'bun:test'",
          "import { average, clamp, isPrime } from './math'",
          '',
          "describe('math helpers', () => {",
          "  test('clamps values to the supplied range', () => {",
          '    expect(clamp(-5, 0, 10)).toBe(0)',
          '    expect(clamp(12, 0, 10)).toBe(10)',
          '    expect(clamp(7, 0, 10)).toBe(7)',
          '  })',
          '',
          "  test('averages numbers', () => {",
          '    expect(average([2, 4, 6, 8])).toBe(5)',
          '    expect(average([])).toBe(0)',
          '  })',
          '',
          "  test('detects prime numbers', () => {",
          '    expect(isPrime(1)).toBe(false)',
          '    expect(isPrime(2)).toBe(true)',
          '    expect(isPrime(9)).toBe(false)',
          '    expect(isPrime(17)).toBe(true)',
          '  })',
          '})',
          '',
        ].join('\n'),
      })
    },
    validate: (workspace) => runCommand(['bun', 'test'], { cwd: workspace, timeoutMs: 60_000 }),
  },
  {
    id: 'cli-parser-fix',
    name: 'CLI parser behavior repair',
    description: 'Fix option parsing edge cases until bun test passes.',
    prompt: taskPrompt,
    setup: async (workspace) => {
      await writeFiles(workspace, {
        'package.json': JSON.stringify({
          name: 'gambit-bench-cli-parser-fix',
          type: 'module',
          scripts: { test: 'bun test' },
        }, null, 2),
        'src/parser.ts': [
          'export interface ParsedArgs {',
          '  file: string | null',
          '  verbose: boolean',
          '  tags: string[]',
          '}',
          '',
          'export function parseArgs(argv: string[]): ParsedArgs {',
          '  const parsed: ParsedArgs = { file: null, verbose: false, tags: [] }',
          '',
          '  for (let index = 0; index < argv.length; index += 1) {',
          '    const arg = argv[index]',
          "    if (arg === '--verbose') {",
          '      parsed.verbose = true',
          '      continue',
          '    }',
          '',
          "    if (arg === '--file') {",
          '      parsed.file = argv[index + 1] ?? null',
          '      continue',
          '    }',
          '',
          "    if (arg === '--tag') {",
          '      parsed.tags = [argv[index + 1]]',
          '      continue',
          '    }',
          '  }',
          '',
          '  return parsed',
          '}',
          '',
        ].join('\n'),
        'src/parser.test.ts': [
          "import { describe, expect, test } from 'bun:test'",
          "import { parseArgs } from './parser'",
          '',
          "describe('parseArgs', () => {",
          "  test('parses flags and repeated tags', () => {",
          "    expect(parseArgs(['--verbose', '--tag', 'api', '--tag', 'ui', '--file', 'notes.md'])).toEqual({",
          "      file: 'notes.md',",
          '      verbose: true,',
          "      tags: ['api', 'ui'],",
          '    })',
          '  })',
          '',
          "  test('does not consume another flag as a value', () => {",
          "    expect(parseArgs(['--file', '--verbose', '--tag', '--file'])).toEqual({",
          '      file: null,',
          '      verbose: true,',
          '      tags: [],',
          '    })',
          '  })',
          '})',
          '',
        ].join('\n'),
      })
    },
    validate: (workspace) => runCommand(['bun', 'test'], { cwd: workspace, timeoutMs: 60_000 }),
  },
]

async function main() {
  const options = parseArgs(Bun.argv.slice(2))
  const selectedTasks = selectTasks(options)

  await mkdir(options.outDir, { recursive: true })
  const runDir = await mkdtemp(path.join(options.outDir, 'run-'))
  const results: BenchResult[] = []

  console.log(`Benchmark run: ${runDir}`)
  console.log(`Agent command: ${options.agentCommand.join(' ')}`)
  console.log(`Tasks: ${selectedTasks.map((task) => task.id).join(', ')}`)

  for (const task of selectedTasks) {
    const result = await runTask(task, runDir, options)
    results.push(result)
    const status = result.passed ? 'PASS' : 'FAIL'
    console.log(`${status} ${task.id} ${formatDuration(result.durationMs)} tools=${result.toolUses}`)
  }

  const summary = summarize(results)
  const summaryPath = path.join(runDir, 'summary.json')
  await Bun.write(summaryPath, `${JSON.stringify(summary, null, 2)}\n`)

  console.log('')
  console.log(`Passed: ${summary.passed}/${summary.total}`)
  console.log(`Summary: ${summaryPath}`)

  if (!options.keep) {
    await cleanupPassingWorkspaces(results)
  }

  if (summary.passed !== summary.total) {
    process.exitCode = 1
  }
}

async function runTask(task: BenchTask, runDir: string, options: BenchOptions): Promise<BenchResult> {
  const taskDir = path.join(runDir, task.id)
  const workspace = path.join(taskDir, 'workspace')
  await mkdir(workspace, { recursive: true })
  await task.setup(workspace)
  await initializeBaseline(workspace)

  const startedAt = Date.now()
  const agent = await runGambit(task, workspace, taskDir, options)
  const validation = await task.validate(workspace)
  const durationMs = Date.now() - startedAt
  const diff = await runCommand(['git', 'diff', '--', '.'], { cwd: workspace, timeoutMs: 30_000 })

  await Bun.write(path.join(taskDir, 'agent.stdout.jsonl'), agent.stdout)
  await Bun.write(path.join(taskDir, 'agent.stderr.txt'), agent.stderr)
  await Bun.write(path.join(taskDir, 'validation.stdout.txt'), validation.stdout)
  await Bun.write(path.join(taskDir, 'validation.stderr.txt'), validation.stderr)
  await Bun.write(path.join(taskDir, 'diff.patch'), diff.stdout)

  const events = parseStreamEvents(agent.stdout)
  const resultEvent = events.find((event) => event.type === 'result')
  const toolUses = events.filter((event) => event.type === 'tool_use').length
  const toolResults = events.filter((event) => event.type === 'tool_result').length
  const model = typeof resultEvent?.model === 'string' ? resultEvent.model : options.model ?? null
  const result = typeof resultEvent?.result === 'string' ? resultEvent.result : ''
  const error = typeof resultEvent?.error === 'string'
    ? resultEvent.error
    : agent.exitCode === 0
      ? null
      : firstNonEmptyLine(agent.stderr) ?? 'agent failed'

  const benchResult: BenchResult = {
    id: task.id,
    name: task.name,
    passed: agent.exitCode === 0 && validation.exitCode === 0 && !agent.timedOut && !validation.timedOut,
    workspace,
    durationMs,
    agentExitCode: agent.exitCode,
    agentTimedOut: agent.timedOut,
    validatorExitCode: validation.exitCode,
    validatorTimedOut: validation.timedOut,
    toolUses,
    toolResults,
    model,
    result,
    error,
  }

  await Bun.write(path.join(taskDir, 'result.json'), `${JSON.stringify(benchResult, null, 2)}\n`)
  return benchResult
}

async function runGambit(
  task: BenchTask,
  workspace: string,
  taskDir: string,
  options: BenchOptions,
): Promise<CommandResult> {
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    WORKSPACE_ROOT: workspace,
    PROJECT_DOC_FALLBACK_FILENAMES: '',
    GAMBIT_MAX_AGENT_STEPS: process.env.GAMBIT_MAX_AGENT_STEPS ?? '80',
  }

  if (options.model) {
    env.GAMBIT_MODEL = options.model
  }

  const promptPath = path.join(taskDir, 'prompt.txt')
  await Bun.write(promptPath, `${task.prompt}\n`)

  return runCommand([
    ...options.agentCommand,
    '-p',
    task.prompt,
    '--output-format',
    'stream-json',
    '--permission-mode',
    'Auto-accept',
    '--allowed-tools',
    'read,grep,glob,edit,write,patchFile,bash',
  ], {
    cwd: workspace,
    env,
    timeoutMs: options.timeoutMs,
  })
}

async function writeFiles(root: string, files: Record<string, string>) {
  for (const [relativePath, content] of Object.entries(files)) {
    const targetPath = path.join(root, relativePath)
    await mkdir(path.dirname(targetPath), { recursive: true })
    await Bun.write(targetPath, content)
  }
}

async function initializeBaseline(workspace: string) {
  await runCommand(['git', 'init', '--quiet'], { cwd: workspace, timeoutMs: 30_000 })
  await runCommand(['git', 'add', '.'], { cwd: workspace, timeoutMs: 30_000 })
}

async function cleanupPassingWorkspaces(results: BenchResult[]) {
  for (const result of results) {
    if (!result.passed) continue
    await rm(result.workspace, { recursive: true, force: true })
  }
}

function parseArgs(argv: string[]): BenchOptions {
  const options: BenchOptions = {
    agentCommand: [process.execPath, path.join(repoRoot, 'src/gambit.tsx')],
    all: false,
    keep: false,
    outDir: defaultOutDir,
    taskIds: [],
    timeoutMs: 10 * 60_000,
  }

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]
    if (arg === '--all') {
      options.all = true
      continue
    }
    if (arg === '--keep') {
      options.keep = true
      continue
    }
    if (arg === '--model') {
      options.model = readRequired(argv, ++index, arg)
      continue
    }
    if (arg === '--out') {
      options.outDir = path.resolve(readRequired(argv, ++index, arg))
      continue
    }
    if (arg === '--task') {
      options.taskIds.push(readRequired(argv, ++index, arg))
      continue
    }
    if (arg === '--timeout-ms') {
      options.timeoutMs = parsePositiveInteger(readRequired(argv, ++index, arg), arg)
      continue
    }
    if (arg === '--agent-cmd') {
      options.agentCommand = splitCommand(readRequired(argv, ++index, arg))
      continue
    }
    if (arg === '--help' || arg === '-h') {
      printHelp()
      process.exit(0)
    }
    throw new Error(`Unknown argument: ${arg}`)
  }

  return options
}

function selectTasks(options: BenchOptions): BenchTask[] {
  if (!options.all && options.taskIds.length === 0) {
    return [tasks[0]!]
  }

  if (options.all) {
    return tasks
  }

  return options.taskIds.map((id) => {
    const task = tasks.find((candidate) => candidate.id === id)
    if (!task) {
      throw new Error(`Unknown task "${id}". Available tasks: ${tasks.map((candidate) => candidate.id).join(', ')}`)
    }
    return task
  })
}

function summarize(results: BenchResult[]) {
  const passed = results.filter((result) => result.passed).length
  return {
    total: results.length,
    passed,
    failed: results.length - passed,
    passRate: results.length === 0 ? 0 : passed / results.length,
    durationMs: results.reduce((total, result) => total + result.durationMs, 0),
    results,
  }
}

async function runCommand(
  command: string[],
  options: { cwd: string; env?: NodeJS.ProcessEnv; timeoutMs: number },
): Promise<CommandResult> {
  const startedAt = Date.now()
  const proc = Bun.spawn(command, {
    cwd: options.cwd,
    env: options.env,
    stdout: 'pipe',
    stderr: 'pipe',
  })
  let timedOut = false
  const timeout = setTimeout(() => {
    timedOut = true
    proc.kill('SIGTERM')
    setTimeout(() => proc.kill('SIGKILL'), 2000).unref()
  }, options.timeoutMs)

  const [stdout, stderr, exitCode] = await Promise.all([
    collectBoundedText(proc.stdout, commandOutputLimitChars),
    collectBoundedText(proc.stderr, commandOutputLimitChars),
    proc.exited,
  ])
  clearTimeout(timeout)

  return {
    exitCode,
    stdout: appendTruncationNotice(stdout, 'stdout'),
    stderr: appendTruncationNotice(stderr, 'stderr'),
    durationMs: Date.now() - startedAt,
    timedOut,
  }
}

function parseStreamEvents(stdout: string): Array<Record<string, JsonValue>> {
  const events: Array<Record<string, JsonValue>> = []
  for (const line of stdout.split(/\r?\n/)) {
    if (!line.trim()) continue
    try {
      const parsed = JSON.parse(line) as JsonValue
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        events.push(parsed)
      }
    } catch {
      // Ignore non-JSON output so a partially broken run can still be scored.
    }
  }
  return events
}

function readRequired(argv: string[], index: number, flag: string): string {
  const value = argv[index]
  if (!value) {
    throw new Error(`${flag} requires a value`)
  }
  return value
}

function parsePositiveInteger(value: string, flag: string): number {
  const parsed = Number.parseInt(value, 10)
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new Error(`${flag} requires a positive integer`)
  }
  return parsed
}

function splitCommand(value: string): string[] {
  const parts = value.match(/(?:[^\s"']+|"[^"]*"|'[^']*')+/g) ?? []
  return parts.map((part) => part.replace(/^['"]|['"]$/g, ''))
}

function formatDuration(durationMs: number): string {
  return `${(durationMs / 1000).toFixed(1)}s`
}

function firstNonEmptyLine(value: string): string | null {
  return value.split(/\r?\n/).map((line) => line.trim()).find(Boolean) ?? null
}

function printHelp() {
  console.log([
    'Usage: bun run bench/gambit-local.ts [options]',
    '',
    'Options:',
    '  --all                    Run every local benchmark task',
    '  --task <id>              Run one task id; repeatable',
    '  --model <id>             Set GAMBIT_MODEL for the run',
    '  --agent-cmd <command>    Agent command to invoke (default: current source checkout)',
    '  --out <path>             Output directory (default: /tmp/gambit-bench)',
    '  --timeout-ms <ms>        Per-task Gambit timeout (default: 600000)',
    '  --keep                   Keep passing task workspaces',
    '  --help                   Show this help',
    '',
    `Available tasks: ${tasks.map((task) => task.id).join(', ')}`,
  ].join('\n'))
}

await main()
