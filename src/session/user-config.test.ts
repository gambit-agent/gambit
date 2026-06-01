import { afterEach, beforeEach, expect, test } from 'bun:test'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'

import { getUserConfigPath, readOpenRouterApiKey, readUserConfig, writeOpenRouterApiKey } from './user-config'

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
  await expect(readUserConfig(configPath)).resolves.toEqual({ openRouterApiKey: null })

  await mkdir(path.dirname(configPath), { recursive: true })
  await writeFile(configPath, '{bad json', 'utf8')

  await expect(readUserConfig(configPath)).resolves.toEqual({ openRouterApiKey: null })
})
