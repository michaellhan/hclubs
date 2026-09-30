# curated-list (curate stage)

The index editor's own list of clubs and links. See ADR 0024.

- **File:** `packages/pipeline/src/curated/list.ts`. It holds names, acronyms, aliases, slugs and URLs only.
- **Command:** `pnpm hci curate [--dry-run]`, then `pnpm hci enrich --club=<slugs printed>`.
- **Websites:** fetched politely (home page) and accepted only when the page names the club. They are recorded as editorial (verified) links.
- **Instagram:** recorded as editorial links. They are never fetched.
- **Not confirmable:** `hauscr.org` (robots.txt disallows crawlers). It is left out of the list until confirmed another way.
- **Reviewed:** 2026-09-30.
