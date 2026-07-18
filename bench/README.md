# Gambit Local Benchmark

This directory contains a small deterministic benchmark for Gambit's headless
coding-agent mode. It creates isolated fixture workspaces under `/tmp`, runs
Gambit against each task, validates with the task's test command, and writes
bounded run output, diffs, validator output, and a summary JSON file.

Run the default smoke task:

```bash
bun run bench:gambit
```

Run every local task:

```bash
bun run bench:gambit -- --all
```

Useful options:

```bash
bun run bench:gambit -- --model qwen/qwen3.6-plus
bun run bench:gambit -- --task ts-unit-fix --keep
bun run bench:gambit -- --out /tmp/gambit-bench --timeout-ms 600000
```

The benchmark invokes `src/gambit.tsx` by default and relies on the same model
configuration as normal headless mode. Set `GAMBIT_MODEL` or pass `--model`, and
make sure the required provider credentials are available.

Each run writes a directory like `/tmp/gambit-bench/run-XXXXXX` with:

- `summary.json` - aggregate score and per-task metrics.
- `<task>/agent.stdout.jsonl` - Gambit's compact stream JSON result output.
- `<task>/agent.stderr.txt` - model/provider/runtime errors.
- `<task>/validation.stdout.txt` and `<task>/validation.stderr.txt` - validator output.
- `<task>/diff.patch` - the patch Gambit produced in the fixture workspace.
- `<task>/result.json` - normalized task result.

Passing task workspaces are removed by default after scoring. Pass `--keep` when
you want to inspect the final workspace contents.
