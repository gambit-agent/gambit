import { mkdir } from 'node:fs/promises'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
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

/**
 * Slugs are random, so an in-memory map alone loses the session-to-plan
 * mapping on restart: a resumed session would mint a fresh slug and its
 * existing plan file became unreachable. Persist the mapping alongside the
 * plans so resuming finds the same file.
 */
function getPlanIndexPath(): string {
  return path.join(getPlansDirectory(), 'index.json')
}

function loadPlanIndex(): Record<string, string> {
  const indexPath = getPlanIndexPath()
  if (!existsSync(indexPath)) {
    return {}
  }
  try {
    const parsed: unknown = JSON.parse(readFileSync(indexPath, 'utf-8'))
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return {}
    }
    return Object.fromEntries(
      Object.entries(parsed as Record<string, unknown>).filter(
        (entry): entry is [string, string] => typeof entry[1] === 'string',
      ),
    )
  } catch {
    // A corrupt index must not break planning; fall back to a fresh slug.
    return {}
  }
}

function persistPlanSlug(sessionId: string, slug: string): void {
  try {
    mkdirSync(getPlansDirectory(), { recursive: true })
    const index = loadPlanIndex()
    index[sessionId] = slug
    writeFileSync(getPlanIndexPath(), `${JSON.stringify(index, null, 2)}\n`, 'utf-8')
  } catch {
    // Best effort: an unwritable index only costs slug stability across restarts.
  }
}

function getPlanSlug(sessionId: string): string {
  const cached = slugCache.get(sessionId)
  if (cached) {
    return cached
  }

  const persisted = loadPlanIndex()[sessionId]
  if (persisted) {
    slugCache.set(sessionId, persisted)
    return persisted
  }

  const plansDir = getPlansDirectory()
  let slug = generateWordSlug()
  for (let i = 0; i < MAX_SLUG_RETRIES; i++) {
    slug = generateWordSlug()
    if (!existsSync(path.join(plansDir, `${slug}.md`))) {
      break
    }
  }

  slugCache.set(sessionId, slug)
  persistPlanSlug(sessionId, slug)
  return slug
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
  if (!resolved.endsWith('.md')) {
    return false
  }
  // Proper containment check: a bare startsWith(plansDir) would also match
  // sibling directories like `.gambit/plansX`.
  const relative = path.relative(plansDir, resolved)
  return relative !== '' && !relative.startsWith('..') && !path.isAbsolute(relative)
}
