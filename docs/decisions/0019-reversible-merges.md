# 0019: Reversible, audited merges; auto-merge only on strong identifiers

**Status:** accepted (M2)

## Decision

- **During discovery**, a listing attaches to an existing club only on a "definite" match: a shared directory id, verified site or verified social handle, or an exact normalized name/alias with no contradicting official site. Otherwise a new club is created. "Probable" (one plausible match) and "ambiguous" (several within 0.05) decisions also create merge candidates with the matcher's signals and a human-readable explanation. Two different ids from the same directory mean two different organizations and are never proposed.
- **During reconcile**, two existing clubs are auto-merged only when they share a strong identifier. Everything weaker becomes a candidate.
- **Merging is non-destructive:** the absorbed club gets `record_state = merged` and `merged_into_club_id`. Claims, mentions and history stay on the original row, and the resolver folds the whole merge family into the survivor.
- `undoMerge` restores both clubs. Every action is logged in `editorial_decision`, and rejected or undone pairs are never re-proposed.
- Review happens in `pnpm hci review` / `merge` / `unmerge` / `reject` or in the dev-only `/admin/review` page.

## Consequences

Duplicates stay visible until reviewed, and a wrong merge costs one click to undo.
