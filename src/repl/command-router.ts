export type RoutedInput =
  | { kind: 'prompt'; value: string }
  | { kind: 'local'; channel: 'colon' | 'shell' | 'memory' | 'slash'; name: string; argument: string; raw: string }
  | { kind: 'local-ui'; channel: 'slash'; name: string; argument: string; raw: string }

export function routeCommandInput(value: string): RoutedInput {
  const trimmed = value.trim()

  if (trimmed.startsWith(':')) {
    const [name = '', ...rest] = trimmed.slice(1).split(' ')
    return {
      kind: 'local',
      channel: 'colon',
      name,
      argument: rest.join(' ').trim(),
      raw: trimmed,
    }
  }

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

  if (trimmed.startsWith('/')) {
    const commandInput = trimmed.slice(1).trim()
    const firstSpace = commandInput.indexOf(' ')
    const name = firstSpace === -1 ? commandInput : commandInput.slice(0, firstSpace)
    const argument = firstSpace === -1 ? '' : commandInput.slice(firstSpace + 1).trim()
    return {
      kind: name === 'model' ? 'local-ui' : 'local',
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
