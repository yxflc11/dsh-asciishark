#!/usr/bin/env bash
# Run from the complete repository or installed package; no npm install needed.
set -euo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROFILE="${DSH_PROFILE_DIR:-$HOME/.dsh/profiles/desktop}"
HELPER="$HERE/scripts/desktop.mjs"
if [ ! -f "$HELPER" ] || [ ! -f "$HERE/scripts/vendor/yaml.mjs" ]; then
  echo "error: installer support files are missing; use the complete repository/package. No files were changed." >&2
  exit 1
fi
CANDIDATES=()
if [ -n "${DSH_NODE_BIN:-}" ]; then
  CANDIDATES+=("$DSH_NODE_BIN")
else
  if command -v node >/dev/null 2>&1; then CANDIDATES+=("$(command -v node)"); fi
  CANDIDATES+=(
    "/Applications/DeepSeek Harness.app/Contents/Resources/runtime/primary-runtime/dependencies/node/bin/node"
    "$HOME/Applications/DeepSeek Harness.app/Contents/Resources/runtime/primary-runtime/dependencies/node/bin/node"
  )
fi
for NODE_BIN in "${CANDIDATES[@]}"; do
  if [ -x "$NODE_BIN" ] && "$NODE_BIN" -e 'process.exit(Number.parseInt(process.versions.node, 10) >= 18 ? 0 : 1)' >/dev/null 2>&1; then
    exec "$NODE_BIN" "$HELPER" uninstall "$PROFILE"
  fi
done
echo "error: Node.js 18+ was not found. Install Node or set DSH_NODE_BIN to its executable. No files were changed." >&2
exit 1
