import { describe, expect, test } from 'bun:test'

import {
  buildSessionConfigOptions,
  getToolKind,
  getToolLocations,
  getToolStatus,
  mapStopReason,
  promptBlocksToInput,
  promptBlocksToText,
} from './protocol-mapper'

describe('ACP protocol mapper', () => {
  test('converts baseline prompt blocks into Gambit text', () => {
    expect(promptBlocksToText([
      { type: 'text', text: 'Review this file.' },
      { type: 'resource_link', name: 'source', title: 'Source file', uri: 'file:///repo/src.ts' },
    ])).toBe('Review this file.\n\n[Source file](file:///repo/src.ts)')
  })

  test('converts ACP image blocks into attachments', () => {
    const input = promptBlocksToInput([{
      type: 'image',
      data: Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).toString('base64'),
      mimeType: 'image/png',
      uri: 'file:///tmp/screen.png',
    }])
    expect(input.text).toBe('')
    expect(input.attachments).toHaveLength(1)
    expect(input.attachments[0]).toMatchObject({ name: 'screen.png', mediaType: 'image/png', size: 8 })
  })

  test('still rejects ACP audio blocks', () => {
    expect(() => promptBlocksToText([{
      type: 'audio',
      data: 'AAAA',
      mimeType: 'audio/wav',
    }])).toThrow('ACP audio prompt content is not supported')
  })

  test('maps Gambit tool and turn state to ACP values', () => {
    expect(getToolKind('readFile')).toBe('read')
    expect(getToolKind('patchFile')).toBe('edit')
    expect(getToolKind('bash')).toBe('execute')
    expect(getToolStatus('started')).toBe('in_progress')
    expect(getToolStatus('cancelled')).toBe('failed')
    expect(mapStopReason({ id: 'turn', startedAt: '', userInput: '', interrupted: true })).toBe('cancelled')
    expect(mapStopReason({ id: 'turn', startedAt: '', userInput: '', finishReason: 'length' })).toBe('max_tokens')
  })

  test('builds absolute tool locations and session controls', () => {
    const locations = getToolLocations({ path: 'src/index.ts' }, process.cwd())
    expect(locations?.[0]?.path).toBeTruthy()

    const options = buildSessionConfigOptions(
      'Plan',
      'openai/gpt-test',
      [{ value: 'openai/gpt-test', name: 'GPT Test' }],
      'high',
    )
    expect(options.find((option) => option.id === 'model')?.currentValue).toBe('openai/gpt-test')
    expect(options.find((option) => option.id === 'permission-mode')?.currentValue).toBe('Plan')
    expect(options.find((option) => option.id === 'reasoning-effort')?.currentValue).toBe('high')
  })
})
