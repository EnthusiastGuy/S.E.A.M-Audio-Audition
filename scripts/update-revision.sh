#!/bin/sh
# Writes the total commit count that will exist on the remote default branch
# immediately after the current push (remote tracking count + commits being pushed).
# Run from repo root, or any directory (uses git rev-parse --show-toplevel).

set -e
ROOT="$(git rev-parse --show-toplevel)"
OUT="$ROOT/_demo/revision.txt"

if git rev-parse --verify '@{u}' >/dev/null 2>&1; then
  remote_count="$(git rev-list --count '@{u}')"
  ahead_count="$(git rev-list --count '@{u}..HEAD')"
  revision=$((remote_count + ahead_count))
else
  revision="$(git rev-list --count HEAD)"
fi

printf '%s\n' "$revision" > "$OUT"
printf 'Wrote revision %s to _demo/revision.txt\n' "$revision"
if ! git diff --quiet -- "$OUT" 2>/dev/null; then
  printf '%s\n' "Note: _demo/revision.txt differs from the index. Add and commit it (e.g. git add _demo/revision.txt && git commit --amend --no-edit) so hosted builds match GitHub."
fi
