# Claude Code hooks for HClubs

Registered in `.claude/settings.json`. Rules for autonomous work are in CLAUDE.md §26.

| Hook                                      | Script              | What it does                                                                                                                                                                                                                                   |
| ----------------------------------------- | ------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `Stop`                                    | `stop-continue.mjs` | In autonomous mode only: blocks stopping while `.claude/autonomous-backlog.md` has P0–P2 items in ACTIVE / IN REVIEW / READY, or a check that failed this session hasn't passed since. Otherwise allows the stop.                              |
| `PostToolUse` Edit/Write                  | `format-edited.mjs` | Prettier on the edited file (only if it was Prettier-clean at HEAD or is new), then ESLint on that file, with problems fed back as context. Never runs tests.                                                                                  |
| `PostToolUse` + `PostToolUseFailure` Bash | `track-checks.mjs`  | Records failed `typecheck` / `lint` / `test` / `build` runs per session and clears them when they pass again. A clean unscoped run (`pnpm test`, `pnpm typecheck`, `pnpm lint`, `pnpm build`, `pnpm check`) clears every failure of that kind. |

## Turning autonomous mode on and off

Autonomous mode is **off by default**. Normal sessions can stop whenever they like.

```bash
touch .claude/autonomous.on   # start: the Stop hook now keeps the lead session working
rm .claude/autonomous.on      # stop: the next stop attempt is allowed
```

Other ways to switch it off:

- `HCLUBS_AUTONOMOUS=0` in the environment overrides the toggle file.
- `"disableAllHooks": true` in `.claude/settings.local.json` (gitignored) turns off every hook, including formatting, for you only.
- Delete the `Stop` entry from `.claude/settings.json` to remove the hook for everyone.

## Loop guards

The hook allows the stop, no matter what the backlog says, when:

- the session is a subagent or teammate (only the lead is driven);
- `stop_hook_active` is set (this stop follows one of the hook's own continuations) and **nothing changed** since the last block: the backlog file, `git HEAD`, `git status` and `git diff` all hash the same;
- the session already got 25 continuations (`MAX_CONTINUATIONS` in `lib.mjs`). Claude Code's own cap, `CLAUDE_CODE_STOP_HOOK_BLOCK_CAP=30` in settings, sits above it;
- the backlog is missing, the input is malformed, or the hook errors.

## Notes

- Check tracking reads the Bash exit status, so run checks as plain commands (`pnpm test`, `pnpm --filter @hci/web typecheck`). Pipelines and `&&` chains aren't tracked, because their exit status isn't the check's.
- Per-session state lives in `.claude/state/` (gitignored). It's safe to delete.
- Test the hooks with `bash .claude/hooks/test-hooks.sh`. It runs against a throwaway git repo.
