# 0042: "No experience needed" as a derived joining fact; name categories v5; data fixes

**Status:** accepted (amends ADR 0041: `joining-v2`; ADR 0034: name categories v5)

## Context

Students ask "can I join without experience?", and a beginner-friendly browse path needs data behind it. LLM extraction has already stored `club.experience_required` claims for 99 clubs, each with a verbatim quote. The value is the extractor's paraphrase, and some paraphrases overreach their quote. Examples: "No experience needed" from "many of our fastest racers began as complete novices", and "No laboratory experience necessary" for one hackathon. A deterministic extractor over the 1,707 stored pages would add only about 2 clubs the LLM missed (snapshot search, 2026-10-02).

## Decision

1. **`joining.noExperience` (`joining-v2`).** `statesNoExperience` (`@hci/core/experience.ts`, pure) reads only the verbatim quotes behind accepted `club.experience_required` values. The fact is `true` when a quote plainly states that no prior experience is needed: "No experience necessary", "you do not need any previous experience", "regardless of prior experience", "from complete beginners to…", "all skill levels". Otherwise it is unknown. It is never `false`, because requirement statements on club pages are mostly about one role or one audition piece. Inferences such as "began as complete novices" don't count. Neither does a statement about a role or event ("Arranging or student conducting (no experience required)", a paraphrase narrowed "(for the BioHackathon)"). The basis rule is `stated_no_experience`. The fact ships in `JoiningSummary` (the static index) so a filter or preset can use it. 43 clubs have it.
2. **Open quote that explains the process.** "There's no need to sweat our auditions — anyone who wants to join … can join" names the process and says everyone gets in. Such a quote makes the single process no-cut (`access: process`, `noCuts`) instead of `mixed`.
3. **Role scope:** "Applications for … committees" (plural) is a committee seat, like the singular form already was.
4. **Name categories v5:** golf, outdoor program, arts program, forensic speech, Chicano/Native American/Asian American, "in Science", wellness, social committee. A service program for youth is not an identity group. A category the audit or an editor rejected for a club is never re-proposed. Vague names stay uncategorized ("Space Group", "Urban Program", "Events Board").
5. **Extractor 1.16.5:** stock, case and pitch competition links ("HFAC x Citadel Stock Pitch Comp") are outsider links, not application pages.
6. **Audit:** website-builder template copy ("Visitors will want to know…", "Click to edit") and constitution article headings are junk descriptions (high-confidence reject).

## Consequences

- The beginner path covers 43 clubs; with open membership it covers 56. That is enough for a filter or preset, but not for a headline claim.
- Hours per week stays at 14 of 705 clubs. Crawled pages rarely state it, so this is a source gap that needs submissions or club pages, not extraction work.
