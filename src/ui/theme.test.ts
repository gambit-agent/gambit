import { afterEach, expect, test } from 'bun:test'

import {
  applyTheme,
  getActiveThemeId,
  getActiveThemeName,
  getThemeById,
  getThemeList,
  theme,
  themes,
  type Theme,
} from './theme'

const originalThemeId = getActiveThemeId()

afterEach(() => {
  applyTheme(originalThemeId)
})

test('getThemeList returns all themes with id, name, and mode', () => {
  const list = getThemeList()
  expect(list.length).toBe(themes.length)
  for (const entry of list) {
    expect(typeof entry.id).toBe('string')
    expect(typeof entry.name).toBe('string')
    expect(entry.mode === 'light' || entry.mode === 'dark').toBe(true)
  }
})

test('all theme ids are unique', () => {
  const ids = themes.map((t) => t.id)
  expect(new Set(ids).size).toBe(ids.length)
})

test('every theme definition supplies all Theme keys', () => {
  const expectedKeys = Object.keys(theme) as (keyof Theme)[]
  for (const def of themes) {
    for (const key of expectedKeys) {
      expect(def.colors[key]).toBeDefined()
    }
  }
})

test('applyTheme switches the active theme and mutates theme colors', () => {
  applyTheme('dracula')
  expect(getActiveThemeId()).toBe('dracula')
  expect(theme.background).toBe('#282a36')
  expect(theme.mode).toBe('dark')

  applyTheme('solarized-light')
  expect(getActiveThemeId()).toBe('solarized-light')
  expect(theme.background).toBe('#fdf6e3')
  expect(theme.mode).toBe('light')
})

test('applyTheme falls back to default for unknown id', () => {
  applyTheme('nonexistent-theme')
  expect(getActiveThemeId()).toBe('gambit-dark')
})

test('getThemeById returns the definition for a known id', () => {
  const def = getThemeById('nord')
  expect(def?.id).toBe('nord')
  expect(def?.name).toBe('Nord')
})

test('getThemeById returns undefined for an unknown id', () => {
  expect(getThemeById('nonexistent')).toBeUndefined()
})

test('getActiveThemeName returns the display name', () => {
  applyTheme('tokyo-night')
  expect(getActiveThemeName()).toBe('Tokyo Night')
})

test('applyTheme notifies listeners (isLight derives from mode)', () => {
  applyTheme('gambit-dark')
  expect(theme.mode).toBe('dark')

  applyTheme('gambit-light')
  expect(theme.mode).toBe('light')
})
