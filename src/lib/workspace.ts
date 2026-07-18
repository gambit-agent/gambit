import fs from "node:fs";
import path from "node:path";
import { workspaceRoot } from "../config";
import { getSkillDirectories } from "./skills";

export interface ResolvedReadablePath {
  absolutePath: string
  displayPath: string
}

/** Maximum symlink hops resolved while locating the existing prefix of a path. */
const MAX_SYMLINK_HOPS = 40

function isPathInside(root: string, candidate: string): boolean {
  const relative = path.relative(root, candidate)
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative))
}

function realpathOrSelf(target: string): string {
  try {
    return fs.realpathSync(target)
  } catch {
    return target
  }
}

/**
 * Resolve symlinks on the existing prefix of `candidate` and re-append the
 * non-existing remainder. Unlike a plain lexical resolve, this exposes where a
 * read or write through `candidate` would actually land on disk, so symlinks
 * inside the workspace cannot be used to escape it. Broken symlinks are
 * followed manually so a dangling link pointing outside the root is still
 * detected before a write materializes its target.
 */
function resolveRealPathWithNonExistingRemainder(candidate: string): string {
  let current = candidate
  const remainder: string[] = []
  let hops = 0

  for (;;) {
    try {
      const real = fs.realpathSync(current)
      return remainder.length > 0 ? path.resolve(real, ...remainder) : real
    } catch {
      // `current` does not fully resolve. If it is a (possibly broken) symlink,
      // follow it manually; otherwise strip the last segment and retry.
      let linkTarget: string | null = null
      try {
        if (fs.lstatSync(current).isSymbolicLink()) {
          linkTarget = fs.readlinkSync(current)
        }
      } catch {
        // `current` does not exist at all.
      }

      if (linkTarget !== null) {
        hops += 1
        if (hops > MAX_SYMLINK_HOPS) {
          throw new Error("Access denied: too many symbolic links while resolving path.")
        }
        current = path.resolve(path.dirname(current), linkTarget)
        continue
      }

      const parent = path.dirname(current)
      if (parent === current) {
        return remainder.length > 0 ? path.resolve(current, ...remainder) : current
      }
      remainder.unshift(path.basename(current))
      current = parent
    }
  }
}

function isRealPathInside(root: string, candidate: string): boolean {
  return isPathInside(realpathOrSelf(root), resolveRealPathWithNonExistingRemainder(candidate))
}

export function resolveWorkspacePath(targetPath: string): string {
  const resolved = path.resolve(workspaceRoot, targetPath);
  if (!isPathInside(workspaceRoot, resolved) || !isRealPathInside(workspaceRoot, resolved)) {
    throw new Error("Access denied: path escapes workspace root.");
  }
  return resolved;
}

export function resolveReadablePath(targetPath: string): ResolvedReadablePath {
  const resolved = path.resolve(workspaceRoot, targetPath)
  if (isPathInside(workspaceRoot, resolved) && isRealPathInside(workspaceRoot, resolved)) {
    return {
      absolutePath: resolved,
      displayPath: relativeWorkspacePath(resolved),
    }
  }

  for (const skillRoot of getSkillDirectories()) {
    const resolvedSkillRoot = path.resolve(skillRoot)
    if (isPathInside(resolvedSkillRoot, resolved) && isRealPathInside(resolvedSkillRoot, resolved)) {
      return {
        absolutePath: resolved,
        displayPath: resolved,
      }
    }
  }

  throw new Error("Access denied: path escapes workspace root and installed skill directories.")
}

export function relativeWorkspacePath(absolutePath: string): string {
  const relative = path.relative(workspaceRoot, absolutePath);
  return relative === "" ? "." : relative;
}
