const hunkHeaderPattern = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/;

/**
 * Validate that every file path referenced inside a unified diff patch is
 * contained within the allowed `targetRelativePaths` list. Throws if a path
 * is unexpected (safety guard against patch-file path traversal).
 */
export function sanitizePatchTargets(patchText: string, targetRelativePaths: string | string[]): void {
  const normalizedTargets = new Set(
    (Array.isArray(targetRelativePaths) ? targetRelativePaths : [targetRelativePaths])
      .filter(Boolean)
      .map((value) => normalizePatchPath(value) ?? value),
  );

  const accepted = new Set<string>();
  for (const target of normalizedTargets) {
    const restful = normalizePatchPath(target);
    if (restful) {
      accepted.add(restful);
      accepted.add(`a/${restful}`);
      accepted.add(`b/${restful}`);
    }
  }

  const lines = patchText.split("\n");
  for (const line of lines) {
    if (line.startsWith("--- ") || line.startsWith("+++ ")) {
      const candidate = line.slice(4).split("\t")[0]?.trim() ?? "";
      if (!candidate || candidate === "/dev/null") {
        continue;
      }
      const normalizedCandidate = normalizePatchPath(candidate);
      if (!normalizedCandidate || !accepted.has(normalizedCandidate) && !accepted.has(candidate)) {
        throw new Error(`Patch references unexpected file path: ${candidate}`);
      }
    }
  }
}

function normalizePatchPath(rawPath: string | null | undefined): string | null {
  if (!rawPath) {
    return null;
  }
  const trimmed = rawPath.replace(/\\/g, "/").replace(/^\.\//, "").trim();
  if (!trimmed || trimmed === "/dev/null") {
    return null;
  }
  if (trimmed.startsWith("a/") || trimmed.startsWith("b/")) {
    return trimmed.slice(2);
  }
  return trimmed;
}

export interface ParsedFilePatch {
  patchText: string;
  oldPath: string | null;
  newPath: string | null;
  rawOldPath: string | null;
  rawNewPath: string | null;
}

/**
 * Split a potentially multi-file unified diff into individual per-file patches.
 * Handles both `diff --git` headers and bare hunk sequences.
 */
export function splitUnifiedDiffByFile(patchText: string): ParsedFilePatch[] {
  const normalized = patchText.replace(/\r/g, "");
  const lines = normalized.split("\n");
  const patches: ParsedFilePatch[] = [];

  let buffer: string[] = [];
  let rawOld: string | null = null;
  let rawNew: string | null = null;
  let recording = false;

  const pushPatch = () => {
    if (!recording) {
      buffer = [];
      rawOld = null;
      rawNew = null;
      return;
    }

    const text = buffer.join("\n");
    patches.push({
      patchText: text,
      rawOldPath: rawOld,
      rawNewPath: rawNew,
      oldPath: normalizePatchPath(rawOld),
      newPath: normalizePatchPath(rawNew),
    });

    buffer = [];
    rawOld = null;
    rawNew = null;
    recording = false;
  };

  for (const line of lines) {
    if (line.startsWith("diff --git ")) {
      pushPatch();
      buffer = [line];
      recording = true;
      continue;
    }

    if (!recording) {
      // Start recording on the first hunk or path line if there was no diff --git header.
      if (line.startsWith("--- ") || line.startsWith("+++ ") || line.startsWith("@@ ")) {
        buffer = [line];
        recording = true;
      } else {
        continue;
      }
    } else {
      buffer.push(line);
    }

    if (line.startsWith("--- ")) {
      rawOld = line.slice(4).split("\t")[0]?.trim() ?? null;
    } else if (line.startsWith("+++ ")) {
      rawNew = line.slice(4).split("\t")[0]?.trim() ?? null;
    }
  }

  pushPatch();

  return patches.filter(({ rawOldPath, rawNewPath }) => rawOldPath !== null || rawNewPath !== null);
}

/** Normalize line endings and split into an array. Empty input becomes an empty array. */
function normalizeLines(text: string): string[] {
  if (text === '') {
    return [];
  }
  return text.replace(/\r/g, '').split('\n');
}

/** Tolerate trailing whitespace mismatches between the patch and the source file. */
function linesMatch(expected: string, actual: string): boolean {
  return expected === actual || expected.trimEnd() === actual.trimEnd();
}

interface HunkOp {
  type: 'context' | 'delete' | 'add';
  payload: string;
}

interface Hunk {
  expectedStart: number; // 0-based
  ops: HunkOp[];
}

function parseHunks(patchLines: string[]): Hunk[] {
  const hunks: Hunk[] = [];
  let currentOps: HunkOp[] | null = null;
  let currentExpectedStart = 0;

  for (let i = 0; i < patchLines.length; i++) {
    const line = patchLines[i];
    if (!line) continue;
    if (line.startsWith("diff --git ") || line.startsWith("--- ") || line.startsWith("+++ ")) {
      continue;
    }

    if (line.startsWith("@@ ")) {
      if (currentOps) {
        hunks.push({ expectedStart: currentExpectedStart, ops: currentOps });
      }
      const match = hunkHeaderPattern.exec(line);
      if (!match) throw new Error(`Invalid hunk header: ${line}`);
      currentExpectedStart = Math.max(parseInt(match[1] ?? "0", 10) - 1, 0);
      currentOps = [];
    } else if (currentOps) {
      if (line.startsWith("\\ No newline")) continue;
      const marker = line[0] ?? "";
      const payload = line.slice(1);
      if (marker === " ") currentOps.push({ type: 'context', payload });
      else if (marker === "-") currentOps.push({ type: 'delete', payload });
      else if (marker === "+") currentOps.push({ type: 'add', payload });
      else throw new Error(`Unsupported patch line: ${line}`);
    }
  }

  if (currentOps) {
    hunks.push({ expectedStart: currentExpectedStart, ops: currentOps });
  }

  return hunks;
}

function hunkSignature(ops: HunkOp[]): string[] {
  return ops.filter(op => op.type === 'context' || op.type === 'delete').map(op => op.payload);
}

function findHunkOffset(sourceLines: string[], startIdx: number, hunk: Hunk): number {
  const sig = hunkSignature(hunk.ops);
  if (sig.length === 0) {
    return Math.min(startIdx, sourceLines.length);
  }

  const offsets = [0];
  for (let d = 1; d <= 15; d++) {
    offsets.push(d, -d);
  }

  for (const offset of offsets) {
    const idx = startIdx + offset;
    if (idx < 0 || idx >= sourceLines.length) continue;
    if (idx + sig.length > sourceLines.length) continue;

    let match = true;
    for (let s = 0; s < sig.length; s++) {
      if (!linesMatch(sig[s]!, sourceLines[idx + s]!)) {
        match = false;
        break;
      }
    }
    if (match) return idx;
  }

  return -1;
}

/**
 * Apply a unified diff to a base text. Supports multi-hunk patches and
 * tolerates trailing whitespace mismatches in context/deletion lines.
 * Throws descriptive errors when hunk headers are invalid or contexts mismatch.
 */
export function applyUnifiedDiff(baseText: string, diffText: string): string {
  const sourceLines = normalizeLines(baseText);
  const patchLines = diffText.replace(/\r/g, "").split("\n");
  const hunks = parseHunks(patchLines);
  const outputLines: string[] = [];
  let sourceIndex = 0;

  for (const hunk of hunks) {
    const actualStart = findHunkOffset(sourceLines, hunk.expectedStart, hunk);
    if (actualStart === -1) {
      const sig = hunkSignature(hunk.ops);
      const expectedLine = hunk.expectedStart + 1;
      throw new Error(
        `Context mismatch while applying patch near line ${expectedLine}. ` +
        `Tried offsets -15 to +15 around expected position. ` +
        `Context signature starts with: ${JSON.stringify(sig.slice(0, 3))}`
      );
    }

    if (actualStart < sourceIndex) {
      throw new Error(
        `Patch hunk at line ${actualStart + 1} overlaps with a previously applied hunk. ` +
        `Current position in source is ${sourceIndex + 1}.`
      );
    }

    while (sourceIndex < actualStart) {
      outputLines.push(sourceLines[sourceIndex] ?? "");
      sourceIndex++;
    }

    for (const op of hunk.ops) {
      if (op.type === 'context') {
        outputLines.push(sourceLines[sourceIndex] ?? "");
        sourceIndex++;
      } else if (op.type === 'delete') {
        sourceIndex++;
      } else if (op.type === 'add') {
        outputLines.push(op.payload);
      }
    }
  }

  for (; sourceIndex < sourceLines.length; sourceIndex++) {
    outputLines.push(sourceLines[sourceIndex] ?? "");
  }

  return outputLines.join("\n");
}
