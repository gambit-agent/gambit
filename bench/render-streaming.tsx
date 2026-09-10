import { createTestRenderer } from '@opentui/core/testing'
import { createRoot } from '@opentui/react'
import { createRef, useSyncExternalStore } from 'react'
import type { ScrollBoxRenderable } from '@opentui/core'
import { ConversationPanel } from '../src/ui/panels/ConversationPanel'
import type { ConversationMessage } from '../src/conversation/conversation-types'
import { createObservableStore } from '../src/lib/observable-store'

function makeMessages(count: number): ConversationMessage[] {
  const out: ConversationMessage[] = []
  for (let i = 0; i < count; i++) {
    const kind = i % 3
    if (kind === 0) out.push({ id: `u${i}`, role: 'user', content: `Question ${i}: please look at the code`, timestamp: new Date().toISOString() })
    else if (kind === 1) out.push({ id: `a${i}`, role: 'assistant', content: `## Answer ${i}\n\nHere is **bold** and a list:\n\n- one\n- two\n\n\`\`\`ts\nconst x = ${i}\n\`\`\`\n`, timestamp: new Date().toISOString() })
    else out.push({ id: `t${i}`, role: 'tool', content: 'Read', timestamp: new Date().toISOString(), metadata: { toolCallId: `c${i}`, toolName: 'readFile', toolStatus: 'completed', toolArgs: { path: `src/f${i}.ts` }, toolResult: 'x'.repeat(2000) } })
  }
  return out
}

const tick = () => new Promise<void>((resolve) => setTimeout(resolve, 0))
const paragraph = 'Streaming text with **bold** and `code` and more words to fill the line out nicely. '
async function run(label: string, count: number, flushes: number) {
  const ref = createRef<ScrollBoxRenderable | null>()
  const initial = [...makeMessages(count), { id: 'stream', role: 'assistant' as const, content: '', timestamp: new Date().toISOString() }]
  const store = createObservableStore<ConversationMessage[]>(initial)
  function Harness() {
    const messages = useSyncExternalStore(store.subscribe, store.getSnapshot)
    return <ConversationPanel messages={messages} scrollboxRef={ref} />
  }
  const setup = await createTestRenderer({ width: 120, height: 40 })
  const root = createRoot(setup.renderer)
  root.render(<Harness />)
  await tick()
  await setup.renderOnce()
  let commitMs = 0
  let renderMs = 0
  let content = ''
  for (let i = 0; i < flushes; i++) {
    content += paragraph.repeat(6) + (i % 4 === 3 ? '\n\n' : '')
    const messages = store.getSnapshot()
    const last = messages[messages.length - 1]!
    const t0 = performance.now()
    store.setState([...messages.slice(0, -1), { ...last, content }])
    await tick()
    const t1 = performance.now()
    await setup.renderOnce()
    const t2 = performance.now()
    commitMs += t1 - t0
    renderMs += t2 - t1
  }
  console.log(`${label}: ${count} msgs, ${flushes} flushes → react ${(commitMs / flushes).toFixed(2)} ms/flush, opentui ${(renderMs / flushes).toFixed(2)} ms/flush`)
  root.unmount()
  setup.renderer.destroy()
}
await run('small history', 10, 60)
await run('large history', 300, 60)
await run('huge history', 1000, 30)
