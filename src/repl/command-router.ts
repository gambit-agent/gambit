export type RoutedInput =
  | { kind: 'prompt'; value: string }
  | { kind: 'local'; channel: 'shell' | 'memory' | 'slash' | 'template'; name: string; argument: string; raw: string }
  | { kind: 'local-ui'; channel: 'slash'; name: string; argument: string; raw: string }

export function routeCommandInput(value: string): RoutedInput {
  const trimmed = value.trim()

  if (trimmed.startsWith('!')) {
    return {
      kind: 'local',
      channel: 'shell',
      name: 'shell',
      argument: trimmed.slice(1).trim(),
      raw: trimmed,
    }
  }

  if (trimmed.startsWith('#')) {
    return {
      kind: 'local',
      channel: 'memory',
      name: 'memory',
      argument: trimmed.slice(1).trim(),
      raw: trimmed,
    }
  }

  if (trimmed.startsWith('@') && /^@[a-zA-Z]/.test(trimmed)) {
    const templateInput = trimmed.slice(1).trim()
    const firstSpace = templateInput.indexOf(' ')
    const name = firstSpace === -1 ? templateInput : templateInput.slice(0, firstSpace)
    const argument = firstSpace === -1 ? '' : templateInput.slice(firstSpace + 1).trim()
    return {
      kind: 'local',
      channel: 'template',
      name,
      argument,
      raw: trimmed,
    }
  }

  if (trimmed.startsWith('/')) {
    const commandInput = trimmed.slice(1).trim()
    const firstSpace = commandInput.indexOf(' ')
    const name = firstSpace === -1 ? commandInput : commandInput.slice(0, firstSpace)
    const argument = firstSpace === -1 ? '' : commandInput.slice(firstSpace + 1).trim()
    return {
      kind: name === 'model' || name === 'resume' ? 'local-ui' : 'local',
      channel: 'slash',
      name,
      argument,
      raw: trimmed,
    }
  }

  return {
    kind: 'prompt',
    value: trimmed,
  }
}
