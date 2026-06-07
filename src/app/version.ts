import { readFileSync } from 'node:fs'

interface PackageMetadata {
  version?: unknown
}

export const appVersion = readPackageVersion()

function readPackageVersion(): string {
  const fallback = Bun.env.npm_package_version?.trim() || '0.0.0'

  try {
    const raw = readFileSync(new URL('../../package.json', import.meta.url), 'utf8')
    const metadata = JSON.parse(raw) as PackageMetadata
    return typeof metadata.version === 'string' && metadata.version.trim() ? metadata.version : fallback
  } catch {
    return fallback
  }
}
