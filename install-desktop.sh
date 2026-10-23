#!/usr/bin/env bash
# Install the ASCII-ocean background into the DSH Desktop profile.
# Idempotent: re-running replaces the package and leaves the patch row alone.
set -euo pipefail

PKG_NAME="@local/dsh-client-ui-ascii-ocean"
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROFILE="${DSH_PROFILE_DIR:-$HOME/.dsh/profiles/desktop}"
DEST="$PROFILE/node_modules/$PKG_NAME"
PATCH="$PROFILE/cordis.patch.yml"

if [ ! -f "$PATCH" ]; then
  echo "error: $PATCH not found — is the DeepSeek Harness Desktop profile initialized?" >&2
  exit 1
fi

# 1. Package first: the Loader must be able to import it the moment the row appears.
mkdir -p "$(dirname "$DEST")"
rm -rf "$DEST"
mkdir -p "$DEST"
cp -R "$HERE/lib" "$HERE/package.json" "$DEST/"

# 2. Patch row: hot-reloaded by dsh-hmr, so the canvas appears without a restart.
if ! grep -q 'id: ui-ascii-ocean' "$PATCH"; then
  [ -n "$(tail -c 1 "$PATCH")" ] && printf '\n' >>"$PATCH"
  cat >>"$PATCH" <<EOF

- insert:
    - id: ui-ascii-ocean
      name: "$PKG_NAME"
EOF
fi

echo "installed: $DEST"
echo "patch row: ui-ascii-ocean -> $(grep -c 'id: ui-ascii-ocean' "$PATCH") occurrence(s)"
echo "DSH hot-reloads the profile patch; no restart needed."
echo "If the app window was already open and still shows an older build of the"
echo "plugin, press Cmd+R once to reload the page (drafts are auto-saved)."
