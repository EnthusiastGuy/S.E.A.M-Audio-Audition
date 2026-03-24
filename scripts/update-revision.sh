#!/bin/sh
# Writes _demo/revision.txt and _demo/js/revision-embed.js.
#
# Modes (first arg):
#   head — current branch total: git rev-list --count HEAD
#          Use for post-commit / post-merge / manual sync after local changes.
#   push — remote tracking count + commits not yet on remote (pre-push).
#
# Run from repo root or any directory (uses git rev-parse --show-toplevel).

set -e
ROOT="$(git rev-parse --show-toplevel)"
OUT="$ROOT/_demo/revision.txt"
EMBED="$ROOT/_demo/js/revision-embed.js"
MODE="${1:-head}"

case "$MODE" in
  push)
    if git rev-parse --verify '@{u}' >/dev/null 2>&1; then
      remote_count="$(git rev-list --count '@{u}')"
      ahead_count="$(git rev-list --count '@{u}..HEAD')"
      revision=$((remote_count + ahead_count))
    else
      revision="$(git rev-list --count HEAD)"
    fi
    ;;
  head)
    revision="$(git rev-list --count HEAD)"
    ;;
  *)
    printf '%s\n' "Usage: $0 [head|push]" >&2
    exit 2
    ;;
esac

printf '%s\n' "$revision" > "$OUT"
printf '%s\n' "/* Auto-updated by scripts/update-revision.sh (or .ps1) together with ../revision.txt */" > "$EMBED"
printf '%s\n' "window.__SEAM_REVISION = $revision;" >> "$EMBED"
printf 'Wrote revision %s to _demo/revision.txt and _demo/js/revision-embed.js (mode=%s)\n' "$revision" "$MODE"
if ! git diff --quiet -- "$OUT" "$EMBED" 2>/dev/null; then
  printf '%s\n' "Note: revision files differ from the index. Add and commit them (e.g. git add _demo/revision.txt _demo/js/revision-embed.js && git commit --amend --no-edit) so the repo tracks the same number."
fi
