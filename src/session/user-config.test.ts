import { afterEach, beforeEach, expect, test } from 'bun:test'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'

import { getUserConfigPath, readOpenRouterApiKey, readUserConfig, writeOpenRouterApiKey, writeThemePreference } from './user-config'

let tempHome: string
let configPath: string

beforeEach(async () => {
  tempHome = await mkdtemp(path.join(tmpdir(), 'gambit-user-config-'))
  configPath = getUserConfigPath(tempHome)
})

afterEach(async () => {
  await rm(tempHome, { recursive: true, force: true })
})

test('writes and reads the user-level OpenRouter API key', async () => {
  await writeOpenRouterApiKey('  sk-test  ', configPath)

  await expect(readOpenRouterApiKey(configPath)).resolves.toBe('sk-test')
})

test('preserves unrelated user config fields when saving the API key', async () => {
  await mkdir(path.dirname(configPath), { recursive: true })
  await writeFile(configPath, JSON.stringify({ theme: 'light' }), 'utf8')

  await writeOpenRouterApiKey('sk-test', configPath)

  await expect(Bun.file(configPath).json()).resolves.toEqual({
    theme: 'light',
    openRouterApiKey: 'sk-test',
  })
})

test('returns an empty config when the user config file is missing or malformed', async () => {
  await expect(readUserConfig(configPath)).resolves.toEqual({ openRouterApiKey: null, maxDepth: null, theme: null })

  await mkdir(path.dirname(configPath), { recursive: true })
  await writeFile(configPath, '{bad json', 'utf8')

  await expect(readUserConfig(configPath)).resolves.toEqual({ openRouterApiKey: null, maxDepth: null, theme: null })
})

test('reads max_depth from the user config', async () => {
  await mkdir(path.dirname(configPath), { recursive: true })
  await writeFile(configPath, JSON.stringify({ max_depth: 7 }), 'utf8')

  await expect(readUserConfig(configPath)).resolves.toEqual({
    openRouterApiKey: null,
    maxDepth: 7,
    theme: null,
  })
})

test('reads the theme preference from the user config', async () => {
  await mkdir(path.dirname(configPath), { recursive: true })
  await writeFile(configPath, JSON.stringify({ theme: 'dracula' }), 'utf8')

  await expect(readUserConfig(configPath)).resolves.toEqual({
    openRouterApiKey: null,
    maxDepth: null,
    theme: 'dracula',
  })
})

test('writes and reads the theme preference', async () => {
  await writeThemePreference('nord', configPath)

  const config = await readUserConfig(configPath)
  expect(config.theme).toBe('nord')
})

test('preserves unrelated fields when saving the theme preference', async () => {
  await mkdir(path.dirname(configPath), { recursive: true })
  await writeFile(configPath, JSON.stringify({ openRouterApiKey: 'sk-existing', max_depth: 3 }), 'utf8')

  await writeThemePreference('gruvbox-dark', configPath)

  await expect(readUserConfig(configPath)).resolves.toEqual({
    openRouterApiKey: 'sk-existing',
    maxDepth: 3,
    theme: 'gruvbox-dark',
  })
})
