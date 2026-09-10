import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'

import { AssistantMessageBuilder } from '../src/conversation/assistant-message-builder'
import { estimateContextTokens } from '../src/conversation/compaction'
import { createConversationStore } from '../src/conversation/conversation-store'
import type { ConversationMessage } from '../src/conversation/conversation-types'
import { getWorkspaceFiles } from '../src/lib/workspace-files'
import { readRawJsonlEntries, writeJsonlEntries } from '../src/session/jsonl'

async function measure(label: string, run: () => Promise<void>): Promise<void> {
  await run()
  const samples: number[] = []
  for (let i = 0; i < 7; i++) {
    const start = performance.now()
    await run()
    samples.push(performance.now() - start)
  }
  samples.sort((a, b) => a - b)
  console.log(`${label}: ${samples[3]!.toFixed(2)} ms median (7 runs)`)
}

function buildToolHeavyConversation(turns: number): ConversationMessage[] {
  const messages: ConversationMessage[] = []
  for (let i = 0; i < turns; i++) {
    const timestamp = new Date().toISOString()
    messages.push({ id: `u${i}`, role: 'user', content: 'do the thing '.repeat(10), timestamp })
    messages.push({ id: `a${i}`, role: 'assistant', content: 'Sure, working. '.repeat(40), timestamp })
    messages.push({
      id: `t${i}`,
      role: 'tool',
      content: 'Read file',
      timestamp,
      metadata: {
        toolCallId: `c${i}`,
        toolName: 'readFile',
        toolStatus: 'completed',
        toolArgs: { path: `src/file${i}.ts` },
        toolResult: { path: `src/file${i}.ts`, content: 'const x = 1;\n'.repeat(2500) },
      },
    })
  }
  return messages
}

const root = await mkdtemp(path.join(tmpdir(), 'gambit-perf-'))
try {
  const transcript = path.join(root, 'transcript.jsonl')
  await writeJsonlEntries(transcript, Array.from({ length: 20_000 }, (_, i) => ({
    id: String(i), role: 'assistant', content: 'Example transcript content. '.repeat(20),
  })))
  await measure('Read 20,000 transcript records', async () => {
    const records = await readRawJsonlEntries(transcript)
    if (records.length !== 20_000) throw new Error('Missing transcript records')
  })
  await measure('Stream 20,000 reasoning/text chunks', async () => {
    const store = createConversationStore({ rootPath: root })
    const builder = new AssistantMessageBuilder(store, true)
    for (let i = 0; i < 10_000; i++) await builder.appendReasoning('reasoning ')
    for (let i = 0; i < 10_000; i++) await builder.appendText('answer ')
    await builder.finish('answer '.repeat(10_000))
    if (store.getSnapshot().messages.length !== 1) throw new Error('Missing assistant message')
  })

  // The footer re-estimates context usage on every streaming flush. Model a
  // flush as one replaced message at the tail of a tool-heavy conversation.
  let conversation = buildToolHeavyConversation(300)
  await measure('Estimate context tokens after one streamed flush (900 messages, ~9 MB of tool output)', async () => {
    const last = conversation[conversation.length - 1]!
    conversation = [...conversation.slice(0, -1), { ...last, content: `${last.content}x` }]
    if (estimateContextTokens(conversation) <= 0) throw new Error('Missing token estimate')
  })

  await measure('Scan workspace files (this repository)', async () => {
    const files = await getWorkspaceFiles(true)
    if (files.length === 0) throw new Error('No workspace files found')
  })
} finally {
  await rm(root, { recursive: true, force: true })
}
