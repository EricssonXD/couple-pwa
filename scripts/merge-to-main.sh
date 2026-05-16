#!/usr/bin/env bash
set -euo pipefail

# Merge the current branch into `main` and switch to `main`.
# Usage: merge-to-main.sh [--push]
#   --push  : push `main` to `origin` after merging

SCRIPT_NAME="$(basename "$0")"

usage() {
  echo "Usage: $SCRIPT_NAME [--push]"
  exit 2
}

PUSH=false
if [[ ${1-} == "--push" ]]; then
  PUSH=true
elif [[ ${1-} == "" ]]; then
  :
elif [[ ${1-} == "-h" || ${1-} == "--help" ]]; then
  usage
else
  usage
fi

if ! git rev-parse --git-dir >/dev/null 2>&1; then
  echo "Not a git repository." >&2
  exit 1
fi

current_branch=$(git rev-parse --abbrev-ref HEAD)
if [[ "$current_branch" == "HEAD" ]]; then
  echo "Detached HEAD; please checkout a branch first." >&2
  exit 1
fi

if [[ "$current_branch" == "main" ]]; then
  echo "Already on 'main' — pulling latest and exiting."
  git pull --ff-only origin main || true
  exit 0
fi

# Ensure working tree is clean
if ! git diff-index --quiet HEAD --; then
  echo "Working tree has uncommitted changes. Commit or stash them first." >&2
  exit 1
fi

echo "Fetching origin..."
git fetch origin --prune

# Ensure local main exists or create from origin/main
if git show-ref --verify --quiet refs/heads/main; then
  echo "Checking out local 'main'..."
  git checkout main
  git pull --ff-only origin main || true
else
  if git show-ref --verify --quiet refs/remotes/origin/main; then
    echo "Creating local 'main' from 'origin/main' and checking out..."
    git checkout -b main origin/main
  else
    echo "No 'main' branch found locally or on origin." >&2
    exit 1
  fi
fi

echo "Merging branch '$current_branch' into 'main'..."
git merge --no-ff --no-edit "$current_branch"

if $PUSH; then
  echo "Pushing 'main' to origin..."
  git push origin main
fi

echo "Switched to 'main' and merged '$current_branch'."
exit 0
