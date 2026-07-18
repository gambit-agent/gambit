export interface SlashCommandFrontmatter {
  description?: string
  argumentHint?: string
  allowedTools?: string[]
  model?: string
  disableModelInvocation?: boolean
}

export type SlashCommandScope = 'project' | 'user'

export interface SlashCommandDefinition {
  id: string
  name: string
  namespace: string | null
  scope: SlashCommandScope
  description: string | null
  argumentHint?: string
  allowedTools: string[]
  model?: string
  disableModelInvocation: boolean
  filePath: string
  relativePath: string
  body: string
}

export interface SlashCommandExecution {
  command: string
  scope: SlashCommandScope
  namespace: string | null
  arguments: string
  allowedTools: string[]
  model?: string
  content: string
}
