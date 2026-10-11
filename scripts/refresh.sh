#!/usr/bin/env bash
# Refresh the index and republish hclubs.app (ADR 0029). Safe to run any time; meant to run
# daily from launchd (scripts/install-refresh.sh).
#
#   scripts/refresh.sh [--weekly] [--no-publish]
#
# Daily: re-crawl what's due (pages older than a week; joining/recruiting pages and
# application forms after 20 h during recruiting season), grounded LLM extraction on
# changed pages only (capped by REFRESH_LLM_BUDGET, default $1; cached pages are free),
# reconcile, republish.
# --weekly also: new articles from the Harvard Independent and Harvard Political Review
# (their free site search), link-based club discovery (free), categories for new clubs, and
# on the first Sunday of the month Instagram follower counts (capped, slow; opt-in with
# HCI_INSTAGRAM=on until the Chrome read is fixed).
# Never spends web-search (Brave) credit. REFRESH_LLM_BUDGET=0 (or HCI_PAID_APIS=off) makes
# the whole run free.
#
# Safety: one run at a time (a lock in data/), any failing step stops the run before the
# publish (set -e, with the failing line logged), and publish-pages.sh itself refuses to
# push when the audit has critical findings or the privacy scan finds anything.
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
mkdir -p data/logs
log="data/logs/refresh-$(date +%Y-%m-%d).log"
# The Sunday job runs with --weekly; the plain daily job steps aside that day.
if [ "$weekly" = 0 ] && [ "${REFRESH_FORCE:-0}" != 1 ] && [ "$(date +%u)" = 7 ]; then
  echo "=== $(date) daily run skipped: Sunday is the weekly run's" >>"$log"
  exit 0
fi
# The budget may also come from .env; it must be a plain non-negative number.
if [ -z "${REFRESH_LLM_BUDGET:-}" ] && [ -f .env ]; then
  REFRESH_LLM_BUDGET="$(sed -n 's/^REFRESH_LLM_BUDGET=//p' .env | tail -1 | tr -d "\"'")"
fi
budget="${REFRESH_LLM_BUDGET:-1}"
# HCI_PAID_APIS=off (shell or .env) makes the run free: skip the LLM steps rather than let them fail.
paid="${HCI_PAID_APIS:-}"
if [ -z "$paid" ] && [ -f .env ]; then paid="$(sed -n 's/^HCI_PAID_APIS=//p' .env | tail -1 | tr -d "\"' ")"; fi
if [[ "$paid" =~ ^([Oo][Ff][Ff]|0|[Ff][Aa][Ll][Ss][Ee]|[Nn][Oo])$ ]]; then budget=0; fi
if ! [[ "$budget" =~ ^[0-9]+([.][0-9]+)?$ ]]; then
  echo "=== $(date) refusing to run: REFRESH_LLM_BUDGET=\"$budget\" is not a number" >>"$log"
  exit 2
fi
exec >>"$log" 2>&1

# One run at a time: launchd can start a missed weekly run while the daily one is going, and
# two runs would double the LLM budget, race on the database and both force-push.
lock="data/refresh.lock"
if ! mkdir "$lock" 2>/dev/null; then
  holder="$(cat "$lock/pid" 2>/dev/null || true)"
  if [ -n "$holder" ] && kill -0 "$holder" 2>/dev/null; then
    echo "=== $(date) another refresh (pid $holder) is running; exiting"
    exit 0
  fi
  echo "=== $(date) removing a stale lock (pid ${holder:-unknown})"
  rm -rf "$lock"
  mkdir "$lock"
fi
echo $$ >"$lock/pid"
trap 'echo "=== FAILED at line $LINENO (exit $?) $(date); nothing published"' ERR
echo "=== refresh $(date) weekly=$weekly publish=$publish budget=\$$budget"

# The dev database (PGlite server) must be running; start it for this run if it isn't.
port="$(sed -n 's/^PGLITE_PORT=//p' .env 2>/dev/null | tail -1)"
port="${port:-54320}"
started_db=0
if ! nc -z 127.0.0.1 "$port" 2>/dev/null; then
  echo "starting database on :$port"
  set -m # own process group, so cleanup stops the server and not just the pnpm wrapper
  pnpm db:start >>"$log" 2>&1 &
  db_pid=$!
  set +m
  started_db=1
  for _ in $(seq 1 60); do nc -z 127.0.0.1 "$port" 2>/dev/null && break; sleep 1; done
fi
cleanup() {
  if [ "$started_db" = 1 ]; then kill -- "-$db_pid" 2>/dev/null || kill "$db_pid" 2>/dev/null || true; fi
  rm -rf "$lock"
}
trap cleanup EXIT

before="$(pnpm --silent hci stats 2>/dev/null | grep -E 'claimsTotal|canonicalClubs' || true)"
# What the site shows now, to report every displayed value the run changes (ADR 0039).
pnpm --silent hci projection save --name=pre-refresh

llm=(--llm --budget="$budget")
if [ "$budget" = 0 ] || [ "$budget" = 0.0 ]; then llm=(); fi
pnpm hci enrich ${llm[@]+"${llm[@]}"} --max-pages=8
# Logos from each site's root page; images are measured once and again after 60 days, so a
# daily run fetches only new or replaced logo files. A failure must not stop the refresh.
pnpm hci logos || echo "logos pass had errors (exit $?); earlier logos were kept"
if [ "$weekly" = 1 ]; then
  pnpm hci press --publisher=independent,hpr
  pnpm hci discover-web --outlinks --limit=200
  if [ "${#llm[@]}" -gt 0 ]; then pnpm hci categorize --budget=0.5; fi
  # Instagram follower counts for the Popularity sort, monthly (the first Sunday): up to
  # REFRESH_INSTAGRAM_LIMIT public profiles (default 110, so ~290 accounts are re-read inside
  # the 90-day limit), the least recently read first, one every 10-15 s in installed Chrome
  # (ADR 0046 amendment). It stops by itself at the first
  # login/rate-limit sign (exit 2), which must not stop the refresh. Opt-in: HCI_INSTAGRAM=on.
  # Opt-in for now (HCI_INSTAGRAM=on): installed Chrome got profile pages without the count
  # in testing (2026-10-03), so an unattended run would only stop after 3 misses.
  if [ "${HCI_INSTAGRAM:-off}" = "on" ] && [ "$(date +%d)" -le 7 ]; then
    ig_limit="${REFRESH_INSTAGRAM_LIMIT:-110}"
    if ! [[ "$ig_limit" =~ ^[0-9]+$ ]]; then ig_limit=110; fi
    pnpm hci instagram-followers --limit="$ig_limit" || echo "instagram-followers stopped early (exit $?); counts read so far were kept"
  fi
fi
# Known error classes a new crawl or LLM run can bring back ("open" beside a comp, a board
# application, a guessed year): the audit's high-confidence fixes reject them (reversible,
# logged, and listed in the summary below). Link checks need review, so they only report.
pnpm --silent hci audit --check=facts,recruiting --apply
# Application forms profiles show: re-fetched weekly (one request each), then forms that stopped
# taking responses or were deleted are rejected. Links that re-read pages no longer carry are
# retracted (enrich re-reads stored pages its crawl stopped reaching; reproduced ones revive).
pnpm hci check-forms || echo "check-forms had errors (exit $?)"
pnpm --silent hci audit --check=links --apply-only=application.form_closed,application.form_deleted
pnpm hci retract-unreproduced --extractor=site-deterministic --field=club.link,cycle.application_url
pnpm hci reconcile # exits non-zero unless every club resolved: no half-resolved publish

after="$(pnpm --silent hci stats 2>/dev/null | grep -E 'claimsTotal|canonicalClubs' || true)"
echo "before: $before"
echo "after:  $after"
# Refresh summary: displayed values changed, by kind (full list: data/reports/projection-diff.md).
diff_out="$(pnpm --silent hci projection diff --name=pre-refresh)"
echo "$diff_out"
# Claim counts include rejected claims, so a day whose only change is a rejection (a closed
# form) looks unchanged by them: the displayed-value diff decides too.
shown_changes="$(echo "$diff_out" | grep -oE '^[0-9]+ changes' | grep -oE '^[0-9]+' || echo 0)"

# Republish when anything changed, and at least weekly (dates like "closes in 3 days" and
# the recruiting board are computed in the browser, so a same-data rebuild isn't needed daily).
if [ "$publish" = 1 ] && { [ "$before" != "$after" ] || [ "${shown_changes:-0}" != 0 ] || [ "$weekly" = 1 ]; }; then
  scripts/publish-pages.sh michaellhan/hclubs-site ""
fi
echo "=== done $(date)"
