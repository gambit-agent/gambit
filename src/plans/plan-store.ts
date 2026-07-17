import { mkdir } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import path from 'node:path'

import { workspaceRoot } from '../config'

const WORD_LIST = [
  'amber', 'anchor', 'arrow', 'basin', 'blade', 'bloom', 'bolt', 'bridge',
  'brook', 'cairn', 'cedar', 'chalk', 'cliff', 'cloud', 'coral', 'crane',
  'creek', 'crest', 'crown', 'dagger', 'delta', 'drift', 'dune', 'eagle',
  'ember', 'falcon', 'fern', 'flame', 'flint', 'forge', 'frost', 'gate',
  'glacier', 'grove', 'harbor', 'hawk', 'haze', 'hedge', 'heron', 'hollow',
  'horizon', 'iron', 'isle', 'jade', 'lance', 'lark', 'ledge', 'lotus',
  'maple', 'marsh', 'mesa', 'mist', 'moss', 'oak', 'opal', 'orbit',
  'otter', 'peak', 'pearl', 'pine', 'plume', 'pond', 'quartz', 'raven',
  'reef', 'ridge', 'river', 'rock', 'sage', 'seal', 'shadow', 'shore',
  'slate', 'spark', 'spring', 'steel', 'stone', 'storm', 'summit', 'swift',
  'thorn', 'tide', 'timber', 'torch', 'trail', 'vale', 'vine', 'wave',
  'willow', 'wind', 'wolf', 'wren', 'zenith',
]

function randomWord(): string {
  return WORD_LIST[Math.floor(Math.random() * WORD_LIST.length)]!
}

function generateWordSlug(): string {
  return `${randomWord()}-${randomWord()}`
}

const MAX_SLUG_RETRIES = 10

/** Cached slugs keyed by session id */
const slugCache = new Map<string, string>()

function getPlansDirectory(): string {
  return path.join(workspaceRoot, '.gambit', 'plans')
}

function getPlanSlug(sessionId: string): string {
  let slug = slugCache.get(sessionId)
  if (!slug) {
    const plansDir = getPlansDirectory()
    for (let i = 0; i < MAX_SLUG_RETRIES; i++) {
      slug = generateWordSlug()
      const filePath = path.join(plansDir, `${slug}.md`)
      if (!existsSync(filePath)) {
        break
      }
    }
    slugCache.set(sessionId, slug!)
  }
  return slug!
}

function setPlanSlug(sessionId: string, slug: string): void {
  slugCache.set(sessionId, slug)
}

function clearPlanSlug(sessionId: string): void {
  slugCache.delete(sessionId)
}

export function getPlanFilePath(sessionId: string): string {
  const slug = getPlanSlug(sessionId)
  return path.join(getPlansDirectory(), `${slug}.md`)
}

async function ensurePlansDirectory(): Promise<void> {
  await mkdir(getPlansDirectory(), { recursive: true })
}

export async function readPlan(sessionId: string): Promise<string | null> {
  const filePath = getPlanFilePath(sessionId)
  try {
    return await Bun.file(filePath).text()
  } catch {
    return null
  }
}

async function writePlan(sessionId: string, content: string): Promise<string> {
  await ensurePlansDirectory()
  const filePath = getPlanFilePath(sessionId)
  await Bun.write(filePath, content)
  return filePath
}

/**
 * Check whether a given file path is a session Plan file.
 * Used by the permission system to allow Plan file writes during Plan mode.
 */
export function isSessionPlanFile(filePath: string): boolean {
  const plansDir = getPlansDirectory()
  const resolved = path.resolve(filePath)
  return resolved.startsWith(plansDir) && resolved.endsWith('.md')
}
