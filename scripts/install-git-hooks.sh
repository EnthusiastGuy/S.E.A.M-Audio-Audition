#!/bin/sh
# Copy versioned hooks into .git/hooks (Unix / Git Bash).
set -e
ROOT="$(git rev-parse --show-toplevel)"
for hook in pre-push post-commit post-merge; do
  src="$ROOT/scripts/git-hooks/$hook"
  dst="$ROOT/.git/hooks/$hook"
  cp "$src" "$dst"
  chmod +x "$dst"
  echo "Installed $dst"
done
echo "pre-push runs update-revision.sh push; post-commit and post-merge run update-revision.sh head."
