#!/usr/bin/env bash
# Remove the ASCII-ocean background from the DSH Desktop profile.
set -euo pipefail

PKG_NAME="@local/dsh-client-ui-ascii-ocean"
PROFILE="${DSH_PROFILE_DIR:-$HOME/.dsh/profiles/desktop}"
DEST="$PROFILE/node_modules/$PKG_NAME"
PATCH="$PROFILE/cordis.patch.yml"

# 1. Drop the patch row first and let dsh-hmr recompose while the package is
#    still on disk. Deleting the package before the row makes the recomposition
#    race a missing import.
python3 - "$PATCH" <<'PY'
import sys

path = sys.argv[1]
with open(path, "r", encoding="utf-8") as handle:
    lines = handle.readlines()

MARK = "ui-ascii-ocean"

def indent_of(line):
    return len(line) - len(line.lstrip(" "))

# Locate top-level `- insert:` patches and drop only the insert entry that
# carries our row, leaving any sibling patch entries untouched.
def find_insert_blocks(lines):
    blocks = []
    i = 0
    while i < len(lines):
        if lines[i].rstrip("\n") == "- insert:":
            start = i
            j = i + 1
            while j < len(lines):
                stripped = lines[j].strip()
                if stripped == "":
                    j += 1
                    continue
                if indent_of(lines[j]) == 0:
                    break
                j += 1
            blocks.append((start, j))
            i = j
        else:
            i += 1
    return blocks

new_lines = list(lines)
for start, end in reversed(find_insert_blocks(new_lines)):
    block = new_lines[start + 1 : end]
    item_indents = [indent_of(line) for line in block if line.strip().startswith("- ")]
    item_indent = min(item_indents) if item_indents else None
    if item_indent is None:
        continue
    entries = []
    current = []
    for line in block:
        if indent_of(line) == item_indent and line.strip().startswith("- "):
            if current:
                entries.append(current)
            current = [line]
        elif current:
            current.append(line)
    if current:
        entries.append(current)
    kept = [entry for entry in entries if not any(MARK in line for line in entry)]
    if len(kept) == len(entries):
        continue  # not our insert block
    if not kept:
        del new_lines[start:end]
    else:
        replacement = []
        for entry in kept:
            replacement.extend(entry)
        new_lines[start + 1 : end] = replacement

# Drop the installer's explanatory comment lines, wherever they survived.
new_lines = [line for line in new_lines if "ASCII-sharks animated background" not in line]
while new_lines and new_lines[-1].strip() == "":
    new_lines.pop()
while new_lines and new_lines[-1].strip() == "- insert:":
    new_lines.pop()
    while new_lines and new_lines[-1].strip() == "":
        new_lines.pop()

with open(path, "w", encoding="utf-8") as handle:
    handle.write("".join(new_lines).rstrip("\n") + "\n")
PY

# 2. Now that the tree no longer references it, remove the package. The
#    wait covers dsh-hmr's default 2 s write-stability window plus a reload.
sleep 8
rm -rf "$DEST"

echo "removed: $DEST"
echo "patch row: $(grep -c 'id: ui-ascii-ocean' "$PATCH" || true) occurrence(s) remaining"
