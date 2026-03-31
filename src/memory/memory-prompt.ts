export function getMemoryPrompt(): string {
  return [
    'Memory policy:',
    '- Memory lives in `.gambit/memory/` as typed markdown files plus `MEMORY.md` index.',
    '- Save only non-derivable context that will matter in future turns.',
    '- Prefer `user`, `feedback`, `project`, or `reference` memory types.',
    '- Use only the relevant memory files for the current request instead of dumping all memory into context.',
  ].join('\n')
}
