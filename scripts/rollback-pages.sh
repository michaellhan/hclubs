#!/usr/bin/env bash
# Put the previous published site back (ADR 0039): pushes data/published/previous, the
# exact tree publish-pages.sh pushed the time before last. Nothing is rebuilt.
#
#   scripts/rollback-pages.sh michaellhan/hclubs-site
set -euo pipefail
repo="${1:?usage: scripts/rollback-pages.sh <owner/repo>}"
root="$(cd "$(dirname "$0")/.." && pwd)"
expected="${PAGES_REPO:-michaellhan/hclubs-site}"
if [ "$repo" != "$expected" ]; then
  echo "error: refusing to push to $repo (expected $expected)" >&2
  exit 2
fi
prev="$root/data/published/previous"
if [ ! -f "$prev/index.html" ]; then
  echo "error: no previous publish kept in $prev" >&2
  exit 1
fi
work="$(mktemp -d)"
trap 'rm -rf "$work"' EXIT
cp -R "$prev/." "$work/"
cd "$work"
git init -q -b main
git config user.name "$(git -C "$root" config user.name)"
git config user.email "$(git -C "$root" config user.email)"
git add -A
git commit -q -m "Roll back to the previous publish"
git push -q --force "https://github.com/$repo.git" main
# The current and previous trees swap, so a second rollback undoes the first.
mv "$root/data/published/current" "$root/data/published/swap" 2>/dev/null || true
mv "$prev" "$root/data/published/current"
mv "$root/data/published/swap" "$prev" 2>/dev/null || true
echo "Rolled back https://github.com/$repo to the previous publish"
