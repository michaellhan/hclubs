#!/usr/bin/env bash
# Build the static site from the local database and publish it to a GitHub Pages repo.
#
#   scripts/publish-pages.sh <owner/repo> [base-path]
#
# The source repo stays private: only the built files in apps/web/out are pushed, to the
# `main` branch of <owner/repo> (a separate public repo with Pages enabled on main / root).
# base-path is the sub-path the site is served under, e.g. "/hci" for
# https://<owner>.github.io/hci/ — use "" for a custom domain or <owner>.github.io.
# With base-path "" and NEXT_PUBLIC_SITE_URL on a custom domain (e.g. https://hclubs.app),
# a CNAME file is published too: every run force-pushes, so Pages would otherwise drop
# the custom domain.
# Requires: `pnpm db:start` running, `gh` logged in. Every run replaces the published site.
set -euo pipefail

repo="${1:?usage: scripts/publish-pages.sh <owner/repo> [base-path]}"
base="${2-/${repo#*/}}"
owner="${repo%%/*}"
root="$(cd "$(dirname "$0")/.." && pwd)"
out="$root/apps/web/out"

export NEXT_PUBLIC_BASE_PATH="$base"
if [ -z "${NEXT_PUBLIC_SITE_URL:-}" ] && [ -f "$root/.env" ]; then
  NEXT_PUBLIC_SITE_URL="$(sed -n 's/^NEXT_PUBLIC_SITE_URL=//p' "$root/.env" | tail -1)"
fi
export NEXT_PUBLIC_SITE_URL="${NEXT_PUBLIC_SITE_URL:-https://$owner.github.io}"
echo "Building for $NEXT_PUBLIC_SITE_URL$NEXT_PUBLIC_BASE_PATH/ …"
(cd "$root" && pnpm --filter @hci/web build)

touch "$out/.nojekyll" # serve the _next/ directory as-is
host="$(printf '%s' "$NEXT_PUBLIC_SITE_URL" | sed -E 's#^https?://##; s#/.*$##')"
if [ -z "$base" ] && [[ "$host" != *.github.io ]]; then
  printf '%s\n' "$host" > "$out/CNAME"
  echo "Custom domain: $host (CNAME)"
fi
work="$(mktemp -d)"
trap 'rm -rf "$work"' EXIT
cp -R "$out/." "$work/"
cd "$work"
git init -q -b main
git config user.name "$(git -C "$root" config user.name)"
git config user.email "$(git -C "$root" config user.email)"
git add -A
git commit -q -m "Publish hclubs ($(git -C "$root" rev-parse --short HEAD), data as of $(date -u +%Y-%m-%d))"
git push -q --force "https://github.com/$repo.git" main
echo "Published to https://github.com/$repo (Pages: $NEXT_PUBLIC_SITE_URL$NEXT_PUBLIC_BASE_PATH/)"
