const hunkHeaderPattern = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/;

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

function normalizeLines(text: string): string[] {
  if (text === '') {
    return [];
  }
  return text.replace(/\r/g, '').split('\n');
}

function linesMatch(expected: string, actual: string): boolean {
  return expected === actual || expected.trimEnd() === actual.trimEnd();
}

export function applyUnifiedDiff(baseText: string, diffText: string): string {
  const sourceLines = normalizeLines(baseText);
  const patchLines = diffText.replace(/\r/g, "").split("\n");
  const outputLines: string[] = [];
  let sourceIndex = 0;

  for (let i = 0; i < patchLines.length; i++) {
    const line = patchLines[i];
    if (!line || !line.startsWith("@@ ")) {
      continue;
    }

    const match = hunkHeaderPattern.exec(line);
    if (!match) {
      throw new Error(`Invalid hunk header: ${line}`);
    }

    const startOld = Math.max(parseInt(match[1] ?? "0", 10) - 1, 0);

    while (sourceIndex < startOld) {
      const originalLine = sourceLines[sourceIndex];
      if (originalLine === undefined) {
        throw new Error("Patch hunk exceeds original file length.");
      }
      outputLines.push(originalLine);
      sourceIndex++;
    }

    i++;
    while (i < patchLines.length) {
      const hunkLine = patchLines[i];
      if (!hunkLine) {
        i++;
        continue;
      }
      if (hunkLine.startsWith("@@ ") || hunkLine.startsWith("--- ") || hunkLine.startsWith("+++ ")) {
        i--;
        break;
      }

      if (hunkLine.startsWith("\\ No newline")) {
        i++;
        continue;
      }

      const marker = hunkLine[0] ?? "";
      const payload = hunkLine.slice(1);

      if (marker === " ") {
        const expected = payload;
        const actual = sourceLines[sourceIndex] ?? "";
        if (!linesMatch(expected, actual)) {
          throw new Error(
            `Context mismatch while applying patch at line ${sourceIndex + 1}.\nExpected: ${JSON.stringify(expected)}\nActual: ${JSON.stringify(actual)}`,
          );
        }
        outputLines.push(actual);
        sourceIndex++;
      } else if (marker === "-") {
        const actual = sourceLines[sourceIndex] ?? "";
        if (!linesMatch(payload, actual)) {
          throw new Error(
            `Deletion mismatch while applying patch at line ${sourceIndex + 1}.\nExpected to delete: ${JSON.stringify(payload)}\nFound: ${JSON.stringify(actual)}`,
          );
        }
        sourceIndex++;
      } else if (marker === "+") {
        outputLines.push(payload);
      } else if (marker.trim() === "") {
        outputLines.push("");
      } else {
        throw new Error(`Unsupported patch line: ${hunkLine}`);
      }

      i++;
    }
  }

  for (; sourceIndex < sourceLines.length; sourceIndex++) {
    outputLines.push(sourceLines[sourceIndex] ?? "");
  }

  return outputLines.join("\n");
}
