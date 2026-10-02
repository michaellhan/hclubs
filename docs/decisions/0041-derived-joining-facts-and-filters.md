# 0041: Derived joining facts, yes/no/unknown filters, scoped processes

**Status:** accepted (amends ADR 0036 on filters and "At a glance", ADR 0037 on the "No comp needed" and "Say they take first-years" labels, ADR 0040 on joining-mode precision)

## Context

A filter audit on 2026-10-02 found that the directory's joining filters answered "does a claim with this exact wording exist?" rather than "what do the sources establish?". Combining "Say they take first-years" with "No comp needed" returned 4 of 689 clubs.

- **Unscoped processes.** `club.join_mode` was a union over every page, so one board application, a competition team's tryouts or a conductor's audition filed an open club as selective (Table Tennis: "just show up" next to tryouts for competition teams).
- **A directory flag read as open membership.** "No Comping Requirement" (SOCO) made 155 clubs "No comp needed", although the flag says nothing about applications or auditions (ADR 0037 already said so in prose).
- **First-years needed the literal word.** "Open to all Harvard College students", "regardless of class year" and "members from all four years" didn't count. Meanwhile "Freshman Welcome Event 2026", "Freshman Jam" and "welcome two new Freshman, Hope and Frank" did. "No academic Seniors." was read as a list of eligible years.
- **Absence leaked into presence.** "No dues" and "No comp" were index booleans present only when true, so unknown and false were indistinguishable everywhere else. Conflicting statements were resolved by source priority, as if one simply won.
- **Duplicated rules.** "open", "selective", "no comp" and "takes first-years" were re-derived in the profile page, "At a glance", the result row, compare, the compare summary, the recruiting board, category pages and presets, each slightly differently.
- **Undated "applications are open"** stayed open all term after one sighting.

## Decision

1. **`deriveJoining` (`@hci/core/joining.ts`, `joining-v1`).** This is a pure function over the accepted claims and their quotes. The resolver (now `resolver-v4`) writes it to a new `club.joining` jsonb projection column. `join_modes` is written from it as general-membership processes only, and `freshmen_eligible` as the derived first-years value. Claims stay atomic. Derived facts record a `basis` (rule, claim ids, pages) and, when a more specific statement outweighed another, `contrary` evidence.
   - **Scope.** A selective process is role-only when every quote names a role: board, executive, director, representative, ambassador or committee; a competition, case or travel team; conductors, soloists, cast or acting roles; or managing a fund. "Reviewed by the executive board" names the reviewer, not a role.
   - **Access.** `open` (open or attendance-based, with no general process), `process` (an application, comp, audition, tryout or invitation for general members), `mixed` (both, which is a conflict), or unknown. Process ≠ selectivity (§9). `noCuts` is set when the single process is stated completion-based or no-cut.
   - **Comp.** No: the College directory flag, or open membership. Yes: a general comp. Both: a conflict.
   - **First-years.** Evidence is ranked by strength:
     - Strength 3: a statement that names first-years, or a class list worded as a restriction.
     - Strength 2: a population that includes everyone ("all Harvard undergraduates", "anyone", in a membership statement).

     A specific "no" beats a generic "yes" (Signet: "first apply in your sophomore year" over "any undergraduate may apply"). Equal-strength disagreement is unknown and listed as a conflict.
   - **Dues.** The resolved dues value; a resolver conflict makes it unknown.
2. **One class-year reader, `classEligibility` (`@hci/core/eligibility.ts`).** It is used by the deterministic extractor (1.16.4), LLM grounding (`g10`), the audit and the derivation. It handles negation, "may not … until", ranges ("first-years through juniors", "first apply as a sophomore … as late as senior year"), "sophomores and up", punch years, excluded years ("no academic seniors"), descriptive hedges ("typically"), graduate-only and outsider populations, and first-year words that modify events or roles.
3. **One join-mode rule, `joinModeProblem` (evidence-rules).** It is shared by the deterministic extractor, LLM grounding and the audit. It adds:
   - negation at a distance ("we do not cut compers or require auditions");
   - grant, other-school-admissions and "help others apply" applications;
   - punch events and fellowship completion read as attendance;
   - an event's "Invitation Only";
   - auditions for other companies;
   - food-and-event listings read as "open to all".

   PBHA volunteer applications count as the club's own recruiting.
4. **Filters are yes/no/unknown.**
   - `openJoin` means access is open. The new `noComp` (`?nocomp=1`) means comp is no. `freshmenEligible` and `noDues` mean the derived first-years and dues values.
   - Unknown is never in a positive or negative bucket.
   - `facetCounts.known` gives yes/no/unknown per filter, shown in tooltips and in a "confirmed matches only; N don't say" line.
   - The Postgres provider applies the same filters over `club.joining` (parity-tested).
5. **Presentation.**
   - Filter groups: Joining, Cost, Selection process (general members only), Usually recruits in, Category, More.
   - Labels: "First-years eligible", "Open membership", "No comp", "No dues". Only "Recognized by Harvard" is offered under recognition; the other statuses stay reachable by URL.
   - Result rows explain matches. "No dues" shows only under that filter.
   - Profile and compare render derived facts with `DerivedFact` (the rule in plain words plus its pages, never a quote). Role-only processes are listed as such.
   - The methodology page documents the rules (`#joining`).
6. **Recruiting.** An undated "applications are open" is open for 21 days after we last saw it (`STATED_OPEN_FRESH_DAYS`).
7. **Audit `joining` group.** It reports mixed access, first-year, comp and dues conflicts, and inactive clubs with live recruiting. It is report-only: a person reads both sources.
8. **Static index.** It is sorted by slug, so builds diff cleanly and tests don't depend on row order.

## Consequences

The changes were made on 2026-10-02 at $0 external spend: an offline replay, with LLM output only from the cache and paid APIs switched off. They cover 689 visible clubs.

| | Before | After |
|---|---:|---:|
| First-years eligible | 37 | 61 (2 no, 0 conflicts) |
| First-years + open membership | 4 | 15 |
| First-years + no comp (new) | — | 22 |
| First-years + finance | 2 | 4 |
| First-years + cultural | 2 | 5 |
| Open membership (was "No comp needed") | 179 | 23 |
| No comp (new) | — | 186 |
| Process stated for members | — | 127 |

The drop to 23 is a correction: the old count was mostly the directory's no-comp flag. Unknown remains large because few club pages say who may join. First-year eligibility is known for 9% of clubs. No stored Harvard page says recognized organizations must admit all class years, so recognition is not used as evidence.

The replay also re-observed stored pages, so about 30 values unrelated to joining changed with the new evidence. Some links became verified, and a few summaries and missions now come from a more recent reading. These were reviewed in `projection diff`.

Claims rejected (reasons recorded, reversible):
- 19 not reproduced by the stricter rules, including the "Freshman Welcome" and "Freshman Jam" events, "we do not require auditions", a board application and a Marine Corps program;
- 4 by the audit (a medical-school anecdote, a scholarship, a grant application, an event's "open to all");
- 2 by hand (Quantum's bake-sale line on the surviving club after a merge; Signet's misread class range).
