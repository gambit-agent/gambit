import type { JsonSchema } from './workflow-types'

export {}

declare global {
  interface WorkflowMeta {
    name: string
    description: string
    whenToUse?: string
    phases?: WorkflowMetaPhase[]
  }

  interface WorkflowMetaPhase {
    title: string
    detail?: string
    model?: string
  }

  interface WorkflowAgentOptions<TSchema = JsonSchema> {
    label?: string
    phase?: string
    schema?: TSchema
    model?: string
    isolation?: 'worktree'
    agentType?: string
    role?: 'default' | 'explorer' | 'worker'
  }

  interface WorkflowBudget {
    total: number | null
    spent(): number
    remaining(): number
  }

  function agent<T = string>(prompt: string, options?: WorkflowAgentOptions): Promise<T>
  function parallel<T>(thunks: Array<() => Promise<T>>): Promise<T[]>
  function pipeline<TItem, TResult = unknown>(
    items: TItem[],
    ...stages: Array<(previous: unknown, original: TItem, index: number) => TResult | Promise<TResult>>
  ): Promise<TResult[]>
  function phase(title: string): void
  function log(message: unknown): void

  const args: unknown
  const cwd: string
  const process: { cwd(): string }
  const budget: WorkflowBudget
}
