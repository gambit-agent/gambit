import { afterEach, beforeEach, expect, test } from 'bun:test'
import { mkdir, mkdtemp, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'

import {
  getUserConfigPath,
  readUserConfig,
  removeProviderCredential,
  writeProviderCredential,
  writeThemePreference,
} from './user-config'

let tempHome: string
let configPath: string

beforeEach(async () => {
  tempHome = await mkdtemp(path.join(tmpdir(), 'gambit-user-config-'))
  configPath = getUserConfigPath(tempHome)
})

afterEach(async () => {
  await rm(tempHome, { recursive: true, force: true })
})

test('returns an empty config when the user config file is missing or malformed', async () => {
  await expect(readUserConfig(configPath)).resolves.toEqual({ maxDepth: null, theme: null, providers: {} })

  await mkdir(path.dirname(configPath), { recursive: true })
  await writeFile(configPath, '{bad json', 'utf8')

  await expect(readUserConfig(configPath)).resolves.toEqual({ maxDepth: null, theme: null, providers: {} })
})

test('reads max_depth from the user config', async () => {
  await mkdir(path.dirname(configPath), { recursive: true })
  await writeFile(configPath, JSON.stringify({ max_depth: 7 }), 'utf8')

  await expect(readUserConfig(configPath)).resolves.toEqual({
    maxDepth: 7,
    theme: null,
    providers: {},
  })
})

test('reads the theme preference from the user config', async () => {
  await mkdir(path.dirname(configPath), { recursive: true })
  await writeFile(configPath, JSON.stringify({ theme: 'dracula' }), 'utf8')

  await expect(readUserConfig(configPath)).resolves.toEqual({
    maxDepth: null,
    theme: 'dracula',
    providers: {},
  })
})

test('writes and reads the theme preference', async () => {
  await writeThemePreference('nord', configPath)

  const config = await readUserConfig(configPath)
  expect(config.theme).toBe('nord')
})

test('preserves unrelated fields when saving the theme preference', async () => {
  await mkdir(path.dirname(configPath), { recursive: true })
  await writeFile(configPath, JSON.stringify({ providers: { openrouter: { apiKey: 'sk-existing' } }, max_depth: 3 }), 'utf8')

  await writeThemePreference('gruvbox-dark', configPath)

  await expect(readUserConfig(configPath)).resolves.toEqual({
    maxDepth: 3,
    theme: 'gruvbox-dark',
    providers: { openrouter: { apiKey: 'sk-existing', baseURL: null } },
  })
})

test('drops the old top-level OpenRouter key when rewriting config', async () => {
  await mkdir(path.dirname(configPath), { recursive: true })
  await writeFile(configPath, JSON.stringify({ openRouterApiKey: 'legacy', max_depth: 3 }), 'utf8')

  await writeProviderCredential('openrouter', { apiKey: 'sk-or', baseURL: null }, configPath)

  await expect(Bun.file(configPath).json()).resolves.toEqual({
    max_depth: 3,
    providers: {
      openrouter: { apiKey: 'sk-or', baseURL: null },
    },
  })
})

test('writes and reads an OpenRouter provider credential', async () => {
  await writeProviderCredential('openrouter', { apiKey: ' sk-or ', baseURL: null }, configPath)

  const config = await readUserConfig(configPath)
  expect(config.providers).toEqual({ openrouter: { apiKey: 'sk-or', baseURL: null } })
})

test('writes and reads a provider credential', async () => {
  await writeProviderCredential('openai', { apiKey: '  sk-openai  ', baseURL: null }, configPath)

  const config = await readUserConfig(configPath)
  expect(config.providers).toEqual({ openai: { apiKey: 'sk-openai', baseURL: null } })
})

test('writes and reads an oauth provider credential', async () => {
  await writeProviderCredential('chatgpt', {
    apiKey: null,
    baseURL: null,
    accessToken: ' access ',
    refreshToken: ' refresh ',
    expiresAt: 123.7,
    accountId: ' account ',
  }, configPath)

  const config = await readUserConfig(configPath)
  expect(config.providers).toEqual({
    chatgpt: {
      apiKey: null,
      baseURL: null,
      accessToken: 'access',
      refreshToken: 'refresh',
      expiresAt: 123,
      accountId: 'account',
    },
  })
})

test('writes the user config with owner-only permissions', async () => {
  await writeProviderCredential('openai', { apiKey: 'sk-openai', baseURL: null }, configPath)

  const mode = (await stat(configPath)).mode & 0o777
  expect(mode).toBe(0o600)
})

test('writes a local provider credential with a base URL and no key', async () => {
  await writeProviderCredential('lmstudio', { apiKey: null, baseURL: 'http://localhost:1234/v1' }, configPath)

  const config = await readUserConfig(configPath)
  expect(config.providers).toEqual({ lmstudio: { apiKey: null, baseURL: 'http://localhost:1234/v1' } })
})

test('ignores unknown provider ids when reading', async () => {
  await mkdir(path.dirname(configPath), { recursive: true })
  await writeFile(configPath, JSON.stringify({ providers: { 'not-a-provider': { apiKey: 'x' } } }), 'utf8')

  const config = await readUserConfig(configPath)
  expect(config.providers).toEqual({})
})

test('removes a provider credential while preserving others', async () => {
  await writeProviderCredential('openai', { apiKey: 'sk-openai', baseURL: null }, configPath)
  await writeProviderCredential('anthropic', { apiKey: 'sk-anthropic', baseURL: null }, configPath)

  await removeProviderCredential('openai', configPath)

  const config = await readUserConfig(configPath)
  expect(config.providers).toEqual({ anthropic: { apiKey: 'sk-anthropic', baseURL: null } })
})
