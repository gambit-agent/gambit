import { expect, test } from 'bun:test'

import { countSteerableEntries, isSteerable, SteeringBridge } from './steering'

test('entries with attachments are not steerable', () => {
  expect(isSteerable({ value: 'check the other file too' })).toBe(true)
  expect(isSteerable({ value: 'look at this', attachments: [] })).toBe(true)
  // Injection appends plain text, so steering this one would drop the image.
  expect(
    isSteerable({
      value: 'look at this',
      attachments: [{ mediaType: 'image/png', data: 'abc' } as never],
    }),
  ).toBe(false)
  expect(isSteerable({ value: '   ' })).toBe(false)
})

test('counting stops at the first entry that cannot be steered', () => {
  const withImage = { value: 'and this', attachments: [{ mediaType: 'image/png', data: 'x' } as never] }

  expect(countSteerableEntries([{ value: 'one' }, { value: 'two' }])).toBe(2)
  // 'three' must not jump ahead of the image entry the user typed before it.
  expect(countSteerableEntries([{ value: 'one' }, withImage, { value: 'three' }])).toBe(1)
  expect(countSteerableEntries([withImage, { value: 'one' }])).toBe(0)
  expect(countSteerableEntries([])).toBe(0)
})

test('an unconnected bridge pulls nothing', () => {
  const bridge = new SteeringBridge()

  expect(bridge.isConnected).toBe(false)
  expect(bridge.pull()).toEqual([])
})

test('a connected bridge pulls trimmed, non-empty text', () => {
  const bridge = new SteeringBridge()
  bridge.setSource(() => ['  actually use grep  ', '', '   ', 'and skip the tests'])

  expect(bridge.isConnected).toBe(true)
  expect(bridge.pull()).toEqual(['actually use grep', 'and skip the tests'])

  bridge.setSource(null)
  expect(bridge.pull()).toEqual([])
})

test('a throwing source never takes down the running turn', () => {
  const bridge = new SteeringBridge()
  bridge.setSource(() => {
    throw new Error('composer unmounted mid-turn')
  })

  expect(bridge.pull()).toEqual([])
})
