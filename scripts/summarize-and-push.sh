#!/usr/bin/env bash
set -euo pipefail

project_root="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$project_root"

if ! git rev-parse --show-toplevel >/dev/null 2>&1; then
  echo "This script must be run from a Git repository." >&2
  exit 1
fi

if ! staged_files="$(git diff --cached --name-only)"; then
  echo "Unable to inspect staged Git changes." >&2
  exit 1
fi
if [[ -n "$staged_files" ]]; then
  echo "Refusing to continue because changes are already staged:" >&2
  printf '%s\n' "$staged_files" >&2
  exit 1
fi

if ! npm run summarize:local; then
  echo "Local summarization failed; no commit or push was performed." >&2
  exit 1
fi

if ! git add -- articles.json; then
  echo "Unable to stage articles.json." >&2
  exit 1
fi

if ! staged_files="$(git diff --cached --name-only)"; then
  echo "Unable to verify staged Git changes." >&2
  exit 1
fi
if [[ -z "$staged_files" ]]; then
  echo "No article data changed; nothing to commit."
  exit 0
fi
if [[ "$staged_files" != "articles.json" ]]; then
  echo "Refusing to commit unexpected staged files:" >&2
  printf '%s\n' "$staged_files" >&2
  exit 1
fi

commit_message="chore: summarize pending articles

Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>"
if ! git commit -m "$commit_message"; then
  echo "Git commit failed; changes were not pushed." >&2
  exit 1
fi

if ! git push; then
  echo "Git push failed. The local commit is preserved; resolve the remote issue and push again." >&2
  exit 1
fi
