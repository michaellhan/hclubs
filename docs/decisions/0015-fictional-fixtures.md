# 0015: Development fixtures are fictional organizations loaded through the claims path

**Status:** accepted (M1)

## Context

The UI needs realistic data to exercise every component: conflicts, stale values, cycles, selectivity. Inventing facts about real Harvard clubs would publish fabricated information (CLAUDE.md §2.2, §23.9).

## Decision

All fixture clubs are invented, with deliberately fictional names. Fixture slugs are prefixed `fixture-`, rows carry `data_origin = 'fixture'`, and sources use the reserved `.invalid` TLD with `is_fixture = true`. The UI shows a "Demo data" badge and a banner, and demo links are rendered unclickable. Fixtures are written as claims with evidence and then resolved, so they exercise the same code as real data. Dates are relative to seed time. `pnpm db:seed` refuses non-local databases unless you pass `--taxonomy-only`. Entity matching excludes fixture clubs so they can never absorb real organizations.

## Consequences

The dev UI is fully exercised without any false statements about real organizations.
