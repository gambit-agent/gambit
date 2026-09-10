# Local hot-path benchmarks

Run `bun run bench/performance-hotpaths.ts` from the repository root. The script
uses temporary data, warms each workload once, and reports the median of seven
runs. It measures transcript reading/parsing, assistant message assembly, the
per-flush context-token estimate, and the workspace file scan; it does not
include model latency or terminal rendering.

Run `bun run bench/render-streaming.tsx` for the rendering side: it mounts the
conversation panel in OpenTUI's test renderer and streams text into the last
message, reporting the React commit and OpenTUI render cost per flush. Run it
with and without `NODE_ENV=production` to compare React builds.

Measured on Windows with Bun 1.4.2:

| Workload | Before | After |
| --- | ---: | ---: |
| Read 20,000 transcript records | 18.72 ms | 12.40 ms |
| Assemble 10,000 reasoning and 10,000 text chunks | 411.97 ms | 18.06 ms |
| Estimate context tokens after one streamed flush (900 messages, ~9 MB tool output) | 4.40 ms | 0.04 ms |
| Scan workspace files, this repository (353 files) | 22.9 ms | 14.6 ms |
| Scan workspace files, synthetic tree (8,000 files + excluded `node_modules`) | 494 ms | 303 ms |

Streaming render, `bench/render-streaming.tsx`, React commit cost per flush:

| History | Development React | Production React |
| --- | ---: | ---: |
| 10 messages | 2.66 ms | 1.99 ms |
| 300 messages | 6.35 ms | 4.66 ms |
| 1,000 messages | 21.93 ms | 13.85 ms |

The OpenTUI render pass adds roughly 0.9 ms, 5.4 ms, and 15.9 ms per flush for
the same three histories in either build; it scales with the number of mounted
messages and is unchanged here.

## Notes

The transcript change parses each already-separated JSON line directly, avoiding
a JSONL parser invocation and result array per record. Malformed lines are still
skipped independently.

The streaming change checks a content-length upper bound before composing the
growing message. The existing exact character threshold, time threshold, and
forced final flush still apply.

The token estimate is cached per message object in a `WeakMap`. Messages are
replaced rather than mutated when they change, so only the message that a flush
rewrote is re-estimated. The footer hook that displays context usage also stops
resolving the model's context length on every flush; it is looked up only when
the model or credential changes.

The workspace scan asks the glob for directory entries (`withFileTypes`) and
keeps regular files, instead of calling `Bun.file(path).exists()` on every
match, which was one extra syscall per entry.

`NODE_ENV` was unset under `bun run` and inlined as `development` by
`bun build --compile` (with or without `--minify`), so React and its reconciler
ran their development builds in every launch path. The CLI entry now defaults
the variable to `production` before React loads, and the compile script,
Makefile, and release workflow set it at build time so the bundler drops the
development branch.
