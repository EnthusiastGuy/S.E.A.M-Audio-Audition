#!/bin/sh
# Copy versioned hooks into .git/hooks (Unix / Git Bash).
set -e
ROOT="$(git rev-parse --show-toplevel)"
cp "$ROOT/scripts/git-hooks/pre-push" "$ROOT/.git/hooks/pre-push"
chmod +x "$ROOT/.git/hooks/pre-push"
echo "Installed pre-push hook. It runs scripts/update-revision.sh before each push."
