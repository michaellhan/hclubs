#!/usr/bin/env bash
# Self-test for the autonomous-session hooks. Runs against a throwaway git repo, never this one.
# Usage: bash .claude/hooks/test-hooks.sh
set -uo pipefail
HOOKS="$(cd "$(dirname "$0")" && pwd)"
REPO_ROOT="$(cd "$HOOKS/../.." && pwd)"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT
export CLAUDE_PROJECT_DIR="$TMP"
unset HCLUBS_AUTONOMOUS
pass=0; fail=0

git -C "$TMP" init -q && git -C "$TMP" -c user.email=t@t -c user.name=t commit -q --allow-empty -m init
mkdir -p "$TMP/.claude"

backlog() { printf '%s\n' "$@" > "$TMP/.claude/autonomous-backlog.md"; }
stop() { echo "$1" | node "$HOOKS/stop-continue.mjs"; }
track() { echo "$1" | node "$HOOKS/track-checks.mjs"; }
expect() { # name, output, "block"|"allow", [grep pattern]
  local blocked=no; grep -q '"decision":"block"' <<<"$2" && blocked=yes
  local want=no; [ "$3" = block ] && want=yes
  if [ "$blocked" = "$want" ] && { [ -z "${4:-}" ] || grep -q -- "$4" <<<"$2"; }; then
    pass=$((pass+1)); echo "ok   $1"
  else
    fail=$((fail+1)); echo "FAIL $1"; echo "     got: $2"
  fi
}

ACTIONABLE=( "# Backlog" "## ACTIVE" "_(none)_" "## READY" "- [P3] polish" "- [P2] saved clubs — owner: frontend-engineer" "- [P1] search benchmark" \
  "## BLOCKED / HUMAN REVIEW" "- [P0] needs owner" "## COMPLETED THIS RUN" "- [P0] done thing" )
backlog "${ACTIONABLE[@]}"

expect "off by default (no toggle file)" "$(stop '{"session_id":"s1","stop_hook_active":false}')" allow
touch "$TMP/.claude/autonomous.on"
expect "blocks on actionable P1/P2, names the P1 first" "$(stop '{"session_id":"s1","stop_hook_active":false}')" block "\[P1\] search benchmark"
expect "HCLUBS_AUTONOMOUS=0 overrides the toggle" "$(HCLUBS_AUTONOMOUS=0 stop '{"session_id":"s1","stop_hook_active":false}')" allow
expect "subagents/teammates are never held" "$(stop '{"session_id":"s1","stop_hook_active":false,"agent_id":"a1","agent_type":"x"}')" allow
expect "recursion guard: no progress since last block → allow" "$(stop '{"session_id":"s1","stop_hook_active":true}')" allow "no change"
echo "work" > "$TMP/file.txt"
expect "recursion guard: progress made → block again" "$(stop '{"session_id":"s1","stop_hook_active":true}')" block
echo "more" >> "$TMP/file.txt"
echo '{"failing":{},"continuations":25,"fingerprint":"x"}' > "$TMP/.claude/state/s1.json"
expect "recursion guard: continuation cap → allow" "$(stop '{"session_id":"s1","stop_hook_active":true}')" allow "continuations"

backlog "## READY" "- [P3] polish" "- [x] [P1] ticked off" "## BLOCKED / HUMAN REVIEW" "- [P0] owner" "## DEFERRED" "- [P1] later" "## COMPLETED THIS RUN" "- [P1] done"
expect "only P3 / blocked / deferred / done / ticked → allow" "$(stop '{"session_id":"s2","stop_hook_active":false}')" allow

track '{"session_id":"s2","hook_event_name":"PostToolUseFailure","tool_input":{"command":"pnpm --filter @hci/web typecheck"},"is_interrupt":false}'
expect "failed typecheck this session → block" "$(stop '{"session_id":"s2","stop_hook_active":false}')" block "typecheck"
track '{"session_id":"s2","hook_event_name":"PostToolUse","tool_input":{"command":"pnpm --filter @hci/web typecheck"}}'
expect "same check passes again → allow" "$(stop '{"session_id":"s2","stop_hook_active":false}')" allow
track '{"session_id":"s2","hook_event_name":"PostToolUseFailure","tool_input":{"command":"pnpm vitest run packages/core"},"is_interrupt":false}'
track '{"session_id":"s2","hook_event_name":"PostToolUse","tool_input":{"command":"pnpm lint"}}'
expect "unrelated check passing doesn't clear a test failure" "$(stop '{"session_id":"s2","stop_hook_active":false}')" block "vitest"
track '{"session_id":"s2","hook_event_name":"PostToolUse","tool_input":{"command":"pnpm test"}}'
expect "full pnpm test clears scoped test failures" "$(stop '{"session_id":"s2","stop_hook_active":false}')" allow
track '{"session_id":"s2","hook_event_name":"PostToolUseFailure","tool_input":{"command":"pnpm hci audit --check=links"},"is_interrupt":false}'
track '{"session_id":"s2","hook_event_name":"PostToolUseFailure","tool_input":{"command":"pnpm build"},"is_interrupt":true}'
expect "pipeline CLI and interrupted runs aren't check failures" "$(stop '{"session_id":"s2","stop_hook_active":false}')" allow

rm -f "$TMP/.claude/autonomous-backlog.md"
expect "missing backlog → allow" "$(stop '{"session_id":"s3","stop_hook_active":false}')" allow
expect "garbage stdin → allow" "$(echo 'not json' | node "$HOOKS/stop-continue.mjs")" allow

# format-edited.mjs runs against the real repo (read-only checks on a scratch file inside it).
export CLAUDE_PROJECT_DIR="$REPO_ROOT"
SCRATCH="$REPO_ROOT/packages/core/src/__hook_selftest.ts"  # untracked, removed below
printf 'const   x = { a:1 }\nexport const y: any = x\n' > "$SCRATCH"
out="$(echo "{\"tool_input\":{\"file_path\":\"$SCRATCH\"}}" | node "$HOOKS/format-edited.mjs")"
if grep -q 'const x = { a: 1 };' "$SCRATCH"; then pass=$((pass+1)); echo "ok   new file gets prettier-formatted"; else fail=$((fail+1)); echo "FAIL prettier"; cat "$SCRATCH"; fi
if grep -q 'no-explicit-any' <<<"$out"; then pass=$((pass+1)); echo "ok   eslint problems reported as context"; else fail=$((fail+1)); echo "FAIL eslint: $out"; fi
rm -f "$SCRATCH"

echo "---"; echo "$pass passed, $fail failed"
[ "$fail" -eq 0 ]
