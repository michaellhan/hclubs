#!/usr/bin/env bash
# Build the static site from the local database and publish it to a GitHub Pages repo.
#
#   scripts/publish-pages.sh <owner/repo> <base-path>
#
# The source repo stays private: only the built files in apps/web/out are pushed, to the
# `main` branch of <owner/repo> (a separate public repo with Pages enabled on main / root).
# base-path is the sub-path the site is served under, e.g. "/hci" for
# https://<owner>.github.io/hci/ — pass "" for a custom domain or <owner>.github.io. It is
# required: a forgotten argument once meant a sub-path build that dropped the custom domain.
# With base-path "" and NEXT_PUBLIC_SITE_URL on a custom domain (e.g. https://hclubs.app),
# a CNAME file is published too: every run force-pushes, so Pages would otherwise drop it.
#
# Every run replaces the published site, so nothing is pushed unless all of these pass:
#   - the target is the expected Pages repo (PAGES_REPO, default michaellhan/hclubs-site),
#     never this source repo;
#   - projections are rebuilt (`hci resolve`) and the audit has no critical finding;
#   - the build succeeds and looks whole (home page, club pages, a parseable index);
#   - `hci privacy-scan` finds nothing in the output.
# Requires: `pnpm db:start` running, `gh` (or git credentials) able to push.
set -euo pipefail

repo="${1:?usage: scripts/publish-pages.sh <owner/repo> <base-path>  (base-path \"\" for a custom domain)}"
if [ "$#" -lt 2 ]; then
  echo "error: pass the base path explicitly (\"\" for a custom domain such as hclubs.app)" >&2
  exit 2
fi
base="$2"
owner="${repo%%/*}"
root="$(cd "$(dirname "$0")/.." && pwd)"
out="$root/apps/web/out"

# 1. The target: only the Pages repo, never the private source repo.
expected="${PAGES_REPO:-michaellhan/hclubs-site}"
if [ "$repo" != "$expected" ]; then
  echo "error: refusing to force-push to $repo (expected $expected; set PAGES_REPO to change it)" >&2
  exit 2
fi
origin="$(git -C "$root" remote get-url origin 2>/dev/null || true)"
case "$origin" in
  *"/$repo" | *"/$repo.git" | *":$repo" | *":$repo.git")
    echo "error: $repo is this source repo's origin; refusing to overwrite it" >&2
    exit 2
    ;;
esac

export NEXT_PUBLIC_BASE_PATH="$base"
if [ -z "${NEXT_PUBLIC_SITE_URL:-}" ] && [ -f "$root/.env" ]; then
  NEXT_PUBLIC_SITE_URL="$(sed -n 's/^NEXT_PUBLIC_SITE_URL=//p' "$root/.env" | tail -1 | tr -d "\"'")"
fi
export NEXT_PUBLIC_SITE_URL="${NEXT_PUBLIC_SITE_URL:-https://$owner.github.io}"
host="$(printf '%s' "$NEXT_PUBLIC_SITE_URL" | sed -E 's#^https?://##; s#/.*$##')"

# 2. Data: rebuild projections from claims, then stop on any critical audit finding.
(cd "$root" && pnpm --silent hci resolve)
(cd "$root" && pnpm --silent hci audit --fail-on=critical >/dev/null) || {
  echo "error: the audit has critical findings (see data/reports/audit.md); not publishing" >&2
  exit 1
}

# 3. Build, then check the output looks like a whole site before anything leaves the machine.
echo "Building for $NEXT_PUBLIC_SITE_URL$NEXT_PUBLIC_BASE_PATH/ …"
(cd "$root" && pnpm --filter @hci/web build)
clubs="$(find "$out/clubs" -mindepth 2 -maxdepth 2 -name index.html 2>/dev/null | wc -l | tr -d ' ')"
if [ ! -f "$out/index.html" ] || [ ! -f "$out/404.html" ] || [ "$clubs" -lt 100 ]; then
  echo "error: the build looks incomplete ($clubs club pages); not publishing" >&2
  exit 1
fi
node -e 'JSON.parse(require("fs").readFileSync(process.argv[1], "utf8"))' "$out/data/index.json" || {
  echo "error: data/index.json is not valid JSON; not publishing" >&2
  exit 1
}
(cd "$root" && pnpm --silent hci privacy-scan "$out") || {
  echo "error: privacy-scan found personal data or secrets in the build; not publishing" >&2
  exit 1
}

touch "$out/.nojekyll" # serve the _next/ directory as-is
if [ -z "$base" ] && [[ "$host" != *.github.io ]]; then
  printf '%s\n' "$host" > "$out/CNAME"
  echo "Custom domain: $host (CNAME)"
fi
if [ -z "$base" ] && [[ "$host" != *.github.io ]] && [ ! -s "$out/CNAME" ]; then
  echo "error: custom-domain build without a CNAME file; the push would drop the domain" >&2
  exit 1
fi

work="$(mktemp -d)"
trap 'rm -rf "$work"' EXIT
cp -R "$out/." "$work/"
# Keep earlier builds' hashed JS/CSS for a while: a visitor with a page open (or HTML
# cached for Pages' 10 minutes) still requests the old chunk names after a republish.
# Only _next/static is archived (content-hashed, immutable); pages and data never are.
archive="$root/data/published-next-static"
# rsync, not `cp -n`: macOS cp exits 1 when it skips existing files, which aborts under set -e.
if [ -d "$archive" ]; then rsync -a --ignore-existing "$archive/" "$work/_next/static/"; fi
cd "$work"
git init -q -b main
git config user.name "$(git -C "$root" config user.name)"
git config user.email "$(git -C "$root" config user.email)"
git add -A
rev="$(git -C "$root" rev-parse --short HEAD)"
if [ -n "$(git -C "$root" status --porcelain --untracked-files=no)" ]; then rev="$rev-dirty"; fi
git commit -q -m "Publish hclubs ($rev, data as of $(date -u +%Y-%m-%d))"
git push -q --force "https://github.com/$repo.git" main
mkdir -p "$archive"
cp -R "$out/_next/static/." "$archive/"
# This build's files were just re-copied (fresh mtime); older ones age out after 14 days.
find "$archive" -type f -mtime +14 -delete
find "$archive" -mindepth 1 -type d -empty -delete
echo "Published to https://github.com/$repo (Pages: $NEXT_PUBLIC_SITE_URL$NEXT_PUBLIC_BASE_PATH/)"
