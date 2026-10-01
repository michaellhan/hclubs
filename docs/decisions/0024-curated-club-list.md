# 0024: Owner-curated club list

**Status:** accepted (M3)

## Context

A student's own list of 40 clubs they had considered showed large gaps. Eighteen weren't indexed at all: pre-professional, finance, startup, cultural and hobby clubs that no Harvard page we can read lists. Eight more had no website on file. The official College directory is behind HarvardKey (ADR 0016), and the model's own knowledge is not a source (§23.8). The index editor, however, can vouch for a club and its links, and §7.1 allows ownership of a channel to be "confirmed editorially".

## Decision

`packages/pipeline/src/curated/list.ts` holds editor-supplied entries. Each entry has a name, an optional acronym, aliases (used for matching only), a slug (to attach to an existing club), `isNew` (the editor checked that the club isn't indexed yet), a website and an Instagram link. It holds names and URLs only, never the editor's own applications or opinions. `pnpm hci curate [--dry-run]` applies the list:

- **Which club:** the slug if given. Otherwise a definite matcher match. Otherwise a new club (`data_origin = editorial`, logged as `add_club`). Entries merely _similar_ to an indexed club are reported for the editor to resolve with a slug or `isNew`, never guessed.
- **Website:** the site is fetched politely (home page only; robots honored). It is recorded only when `curatedPageMatch` accepts the page: the finder's rule, a heading with the club's full name, or a heading with its acronym on a page that mentions Harvard. It is written as an `editorial` `club.link` claim evidenced by that snapshot and logged as `confirm_link`, so the link is **verified** (ADR 0017), and enrichment crawls it as the club's official site.
- **Instagram:** recorded as an editorial link with a `source_type = editorial` source row. It is never fetched (§21).
- **Name and acronym claims (editorial)** are written only for clubs the list created, so resolved names of existing clubs are never overridden.
  - Amendment (2026-10-01): the entry's acronym and aliases are now claimed for existing clubs too (editorial `club.acronym` / `club.alias`), so search finds them. The name of an existing club is claimed only with `rename: true`, and only when the club's own website names it by the new name; the entry's aliases then become `former` names. First use: Harvard College Consulting Group → Harvard Undergraduate Consulting Group (HUCG), as its site now says. The slug is unchanged.

`hide <slug> --reason` / `unhide <slug>` were added at the same time for rows that aren't in-scope student organizations. The command sets `record_state = hidden`, is audited in `editorial_decision`, and is reversible.

## Consequences

- An editor can close coverage gaps quickly, and every link still rests on a real snapshot and an audit row.
- A site whose robots.txt disallows us (HAUSCR) can't be confirmed and stays out until the club is reachable or confirmed by other means.
- Editorial claims outrank all sources in the resolver. A wrong entry is fixed by editing the list and rejecting the claim, which is logged and reversible.
