import path from "node:path";
import { workspaceRoot } from "../config";
import { getSkillDirectories } from "./skills";

export interface ResolvedReadablePath {
  absolutePath: string
  displayPath: string
}

function isPathInside(root: string, candidate: string): boolean {
  const relative = path.relative(root, candidate)
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative))
}

export function resolveWorkspacePath(targetPath: string): string {
  const resolved = path.resolve(workspaceRoot, targetPath);
  if (!isPathInside(workspaceRoot, resolved)) {
    throw new Error("Access denied: path escapes workspace root.");
  }
  return resolved;
}

export function resolveReadablePath(targetPath: string): ResolvedReadablePath {
  const resolved = path.resolve(workspaceRoot, targetPath)
  if (isPathInside(workspaceRoot, resolved)) {
    return {
      absolutePath: resolved,
      displayPath: relativeWorkspacePath(resolved),
    }
  }

  for (const skillRoot of getSkillDirectories()) {
    const resolvedSkillRoot = path.resolve(skillRoot)
    if (isPathInside(resolvedSkillRoot, resolved)) {
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
