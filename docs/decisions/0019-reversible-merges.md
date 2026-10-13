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

## Amendment (2026-10-03): the survivor keeps its own name (resolver-v9)

**Problem.** The resolver folded the merge family's `club.name` claims into one pool, so a merged-in duplicate's tier-1 listing name (the SOCO directory's "PBHA's LEADERS! Summer Program", "ApiChorus: Harvard Hillel Jewish Student A Capella Group") outranked the survivor's own name from its own program page or site and renamed the club on every merge.

**Decision.**
- Claims keep their original `club_id` (the merge chain), and the resolver now receives it as `ClaimInput.subjectId`.
- A registry field flagged `survivorFirst` (only `club.name`) is resolved over the survivor's own active claims when it has any. The absorbed clubs' claims count only when the survivor has none. Among the survivor's own claims the usual priority-then-recency ranking applies.
- The absorbed clubs' names that aren't displayed are projected as `alternate` aliases (`absorbedNameAliases`, deduped by normalized name), so a search for the absorbed listing's name still finds the club. Rejected name claims stay excluded from both.
- Not done: ranking SOCO's listing-style names ("PBHA's …") below a club's own source for unmerged clubs. A tier-1 listing name is usually the registered name and right, and no simple rule separates the listing-style ones; `reject-value` handles the exceptions.

**Effect on the live data (reconcile, projection diff).** Two displayed names changed, both to the survivor's own name: "PBHA's CHANCE" became "College High-School Alliance: A Nexus for Creative Education (CHANCE)" (pbha.org), and "Harvard GSAS Biotech Club" became "Harvard GSAS Biotechnology Club" (the career center's listing, matching the slug). Two more names kept their value but are now backed by the survivor's own listing.

## Amendment (2026-10-13): shared hosts are not strong identifiers (matcher-v4)

**Problem.** `ingest:reconcile` auto-merged the Hasty Pudding Club, the Hasty Pudding Institute of 1770 and the Hasty Pudding Theatricals (lead undid the merges and rejected the links by hand). Their "strong identifiers" were the host hastypudding.org, where each club's site is one folder (`/hasty-pudding-club`, `/hasty-pudding-theatricals`, the Institute at the root), and @thehastypudding on Instagram/Facebook/X/YouTube, read off that host's footer by every club's crawl.

**Decision.** `loadKnownOrgs` marks each verified website that `pathScopedRoot` scopes to a folder (unless the club also has an unscoped website on that host, which makes it the host's owner) as `scopedSites`, and each verified social account whose every piece of evidence comes from a page on such a shared host or from a nav/footer link (`evidence_locator.chrome`) as `hostDerivedSocials`. In `matchOrganization` (matcher-v4) a shared site key is a strong `site` signal only when neither club is scoped on it or one club's URL there is inside the other's folder; otherwise it is a `shared_host` signal (0.3, not strong). For such a pair (shared host, different folders), an account either club has only from that host or from chrome is a `shared_host_social` signal (0.2, not strong). These pairs become merge candidates for review at most. Same own domain, the same folder, and an account each club has from an independent source still auto-merge.

**Effect on the live data.** A read-only replay of the dedupe over the live DB: no auto-merges and no new candidates (the Hasty Pudding pairs are undone). With review statuses ignored, matcher-v3 would re-merge Club → Institute and Theatricals → Institute on site(hastypudding.org); matcher-v4 proposes both for review (`shared_host`). 12 clubs have path-scoped sites; for the other 10, best-match decisions are unchanged.
