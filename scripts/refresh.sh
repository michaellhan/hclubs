#!/usr/bin/env bash
# Refresh the index and republish hclubs.app (ADR 0029). Safe to run any time; meant to run
# daily from launchd (scripts/install-refresh.sh).
#
#   scripts/refresh.sh [--weekly] [--no-publish]
#
# Daily: re-crawl what's due (pages older than a week; joining/recruiting pages and
# application forms after 20 h during recruiting season), grounded LLM extraction on
# changed pages only (capped by REFRESH_LLM_BUDGET, default $1), reconcile, republish.
# --weekly also: new articles from the Harvard Independent and Harvard Political Review
# (their free site search), link-based club discovery (free), categories for new clubs.
# Never spends web-search (Brave) credit.
set -euo pipefail

root="$(cd "$(dirname "$0")/.." && pwd)"
cd "$root"
weekly=0
publish=1
for arg in "$@"; do
  case "$arg" in
    --weekly) weekly=1 ;;
    --no-publish) publish=0 ;;
    *) echo "unknown option $arg" >&2; exit 2 ;;
  esac
done
# The Sunday job runs with --weekly; the plain daily job steps aside that day.
if [ "$weekly" = 0 ] && [ "${REFRESH_FORCE:-0}" != 1 ] && [ "$(date +%u)" = 7 ]; then exit 0; fi
budget="${REFRESH_LLM_BUDGET:-1}"
mkdir -p data/logs
log="data/logs/refresh-$(date +%Y-%m-%d).log"
exec >>"$log" 2>&1
echo "=== refresh $(date) weekly=$weekly publish=$publish budget=\$$budget"

# The dev database (PGlite server) must be running; start it for this run if it isn't.
port="$(sed -n 's/^PGLITE_PORT=//p' .env 2>/dev/null | tail -1)"
port="${port:-54320}"
started_db=0
if ! nc -z 127.0.0.1 "$port" 2>/dev/null; then
  echo "starting database on :$port"
  pnpm db:start >>"$log" 2>&1 &
  db_pid=$!
  started_db=1
  for _ in $(seq 1 60); do nc -z 127.0.0.1 "$port" 2>/dev/null && break; sleep 1; done
fi
cleanup() { if [ "$started_db" = 1 ]; then kill "$db_pid" 2>/dev/null || true; fi; }
trap cleanup EXIT

before="$(pnpm --silent hci stats 2>/dev/null | grep -E 'claimsTotal|canonicalClubs' || true)"

pnpm hci enrich --llm --budget="$budget" --max-pages=8
if [ "$weekly" = 1 ]; then
  pnpm hci press --publisher=independent,hpr
  pnpm hci discover-web --outlinks --limit=200
  pnpm hci categorize --budget=0.5
fi
pnpm hci reconcile

after="$(pnpm --silent hci stats 2>/dev/null | grep -E 'claimsTotal|canonicalClubs' || true)"
echo "before: $before"
echo "after:  $after"

# Republish when anything changed, and at least weekly (dates like "closes in 3 days" and
# the recruiting board are computed in the browser, so a same-data rebuild isn't needed daily).
if [ "$publish" = 1 ] && { [ "$before" != "$after" ] || [ "$weekly" = 1 ]; }; then
  scripts/publish-pages.sh michaellhan/hclubs-site ""
fi
echo "=== done $(date)"
