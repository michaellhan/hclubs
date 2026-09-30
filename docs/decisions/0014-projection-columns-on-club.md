# 0014: Resolved display columns live on `club`, written only by the resolver

**Status:** accepted (M1)

## Context

CLAUDE.md §5 proposed a separate `club_profile` projection table. The directory needs to filter and sort on resolved attributes (join modes, first-year eligibility, recognition, member range) with simple indexed queries.

## Decision

`club` holds identity (slug, canonical name, record state, merge pointer) **and** projection columns (`acronym`, `short_description`, `join_modes`, `freshmen_eligible`, `member_count_min/max`, …, plus a `fields` JSONB with per-field provenance). Only `resolveClub()` in `packages/db/src/resolve/project.ts` writes the projection columns. Ingestion code never does. Other projections: `club_alias`, `club_link`, `club_category`, `membership_estimate`, `recruiting_cycle` display columns, `recruiting_stage`, `club_search_document`.

## Consequences

- Filters are plain column predicates with no joins against claims.
- Every projection can be rebuilt with `pnpm hci resolve`.
- The rule is enforced by convention and code review. There is no DB-level guard.
