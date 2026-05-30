#!/usr/bin/env bash

set -euo pipefail

# Compatibility entrypoint. The extensionless ./install script is the canonical
# installer so users can run:
#   curl -fsSL https://raw.githubusercontent.com/sergiomasellis/gambit-cli/main/install | bash

repo="${GAMBIT_REPO:-sergiomasellis/gambit-cli}"
ref="${GAMBIT_INSTALL_REF:-main}"
script_dir=""

if [[ -n "${BASH_SOURCE[0]:-}" ]]; then
  script_dir="$(CDPATH= cd -- "$(dirname -- "${BASH_SOURCE[0]}")" >/dev/null 2>&1 && pwd || true)"
fi

if [[ -n "$script_dir" && -f "$script_dir/install" ]]; then
  exec bash "$script_dir/install" "$@"
fi

if command -v curl >/dev/null 2>&1; then
  curl -fsSL "https://raw.githubusercontent.com/${repo}/refs/heads/${ref}/install" | bash -s -- "$@"
  exit $?
fi

if command -v wget >/dev/null 2>&1; then
  wget -q -O - "https://raw.githubusercontent.com/${repo}/refs/heads/${ref}/install" | bash -s -- "$@"
  exit $?
fi

echo "Error: curl or wget is required." >&2
exit 1
