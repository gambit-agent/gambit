import packageJson from '../../package.json' with { type: 'json' }

interface PackageMetadata {
  version?: unknown
}

export const appVersion = readPackageVersion()

function readPackageVersion(): string {
  const fallback = Bun.env.npm_package_version?.trim() || '0.0.0'
  const metadata = packageJson as PackageMetadata
  return typeof metadata.version === 'string' && metadata.version.trim() ? metadata.version : fallback
}
