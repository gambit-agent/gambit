#!/usr/bin/env bash

set -euo pipefail

# Source checkout bootstrap. For released binaries, prefer ./install.

cd "$(dirname "$0")"

if ! command -v bun >/dev/null 2>&1; then
  echo "Error: Bun is required. Install it from https://bun.sh, then rerun setup.sh." >&2
  exit 1
fi

bun install
bun run tsc --noEmit
make install

echo ""
echo "Gambit is installed. Run it with: gambit"
