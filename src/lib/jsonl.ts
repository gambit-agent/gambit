import { appendFile } from "node:fs/promises"

export async function appendJsonlEntry(filePath: string, payload: unknown): Promise<void> {
  const line = `${JSON.stringify(payload)}\n`
  await appendFile(filePath, line, "utf8")
}

