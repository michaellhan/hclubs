import { z } from "zod";
import { CLASS_YEARS, JOIN_MODES, RECRUITING_SEASONS, STAGE_KINDS } from "@hci/core";

/**
 * What the LLM may return. Every item carries `quote`: an exact, verbatim excerpt from
 * the provided text that states the value. Everything is nullable/optional-by-empty so
 * the model can say "not stated". Post-processing verifies each quote against the text.
 */
const Quote = z
  .string()
  .min(3)
  .max(600)
  .describe("Exact verbatim excerpt from the provided text that states this value.");

/** What the model returns (as JSON), validated then grounded. `null`/empty means "not stated". */
export const LlmExtraction = z.object({
  short_description: z.object({ value: z.string().max(400), quote: Quote }).nullable(),
  mission: z.object({ value: z.string().max(1200), quote: Quote }).nullable(),
  join_modes: z.array(z.object({ value: z.enum(JOIN_MODES), quote: Quote })).max(6),
  eligible_classes: z.object({ value: z.array(z.enum(CLASS_YEARS)).min(1), quote: Quote }).nullable(),
  prior_experience: z.object({ value: z.string().max(300), quote: Quote }).nullable(),
  hours_per_week: z
    .object({ min: z.number().nullable(), max: z.number().nullable(), during_comp: z.boolean(), quote: Quote })
    .nullable(),
  member_count: z
    .object({
      exact: z.number().int().nullable(),
      min: z.number().int().nullable(),
      max: z.number().int().nullable(),
      quote: Quote,
    })
    .nullable(),
  dues: z.object({ has_dues: z.boolean(), amount_usd: z.number().nullable(), quote: Quote }).nullable(),
  recruiting: z
    .array(
      z.object({
        term_text: z.string().nullable(),
        opens_text: z.string().nullable(),
        deadline_text: z.string().nullable(),
        // A long list (several boards' steps run together) keeps its first ten rather than
        // failing the whole page's answer (The Crimson: Business Board, 2026-10-12).
        stages: z.preprocess(
          (v) => (Array.isArray(v) ? v.slice(0, 10) : v),
          z.array(z.object({ kind: z.enum(STAGE_KINDS), label: z.string().max(120).nullable() })).max(10),
        ),
        quote: Quote,
      }),
    )
    .max(4),
  recruiting_seasons: z.object({ value: z.array(z.enum(RECRUITING_SEASONS)).min(1), quote: Quote }).nullable(),
  selectivity: z
    .array(
      z.object({
        term_text: z.string().nullable(),
        applicants: z.number().int().nullable(),
        interviewed: z.number().int().nullable(),
        offers: z.number().int().nullable(),
        accepted: z.number().int().nullable(),
        acceptance_rate_percent: z.number().nullable(),
        quote: Quote,
      }),
    )
    .max(4),
  activities: z.array(z.object({ value: z.string().max(300), quote: Quote })).max(30),
  sponsors: z.array(z.object({ value: z.string().max(80), quote: Quote })).max(20),
});

export type LlmExtraction = z.infer<typeof LlmExtraction>;

export const PROMPT_VERSION = "club-extract-v4";

/**
 * The JSON shape, written out compactly for the prompt. The API's schema-constrained
 * output rejects a schema this size ("compiled grammar is too large"), so the model is
 * asked for JSON in text and `LlmExtraction` validates it (invalid output is retried).
 * Keep in sync with `LlmExtraction` (a test checks the keys match).
 */
export const JSON_SHAPE = `{
  "short_description": {"value": string, "quote": string} | null,
  "mission": {"value": string, "quote": string} | null,
  "join_modes": [{"value": ${JOIN_MODES.map((m) => `"${m}"`).join(" | ")}, "quote": string}],
  "eligible_classes": {"value": [${CLASS_YEARS.map((c) => `"${c}"`).join(" | ")}], "quote": string} | null,
  "prior_experience": {"value": string, "quote": string} | null,
  "hours_per_week": {"min": number | null, "max": number | null, "during_comp": boolean, "quote": string} | null,
  "member_count": {"exact": integer | null, "min": integer | null, "max": integer | null, "quote": string} | null,
  "dues": {"has_dues": boolean, "amount_usd": number | null, "quote": string} | null,
  "recruiting": [{"term_text": string | null, "opens_text": string | null, "deadline_text": string | null,
                  "stages": [{"kind": ${STAGE_KINDS.map((k) => `"${k}"`).join(" | ")}, "label": string | null}], "quote": string}],
  "recruiting_seasons": {"value": [${RECRUITING_SEASONS.map((r) => `"${r}"`).join(" | ")}], "quote": string} | null,
  "selectivity": [{"term_text": string | null, "applicants": integer | null, "interviewed": integer | null,
                   "offers": integer | null, "accepted": integer | null, "acceptance_rate_percent": number | null, "quote": string}],
  "activities": [{"value": string, "quote": string}],
  "sponsors": [{"value": string, "quote": string}]
}`;

export const SYSTEM_PROMPT = `You extract structured facts about a student organization from web page text.

Rules:
- Use ONLY the provided text. Do not use outside knowledge about Harvard or any organization.
- If a field is not explicitly supported by the text, return null (or an empty list). Missing is correct; guessing is wrong.
- Every value must include "quote": an exact, verbatim, contiguous excerpt copied from the text that states it. Do not paraphrase quotes.
- Numbers (member counts, applicants, hours, dues, percentages) must appear literally in the quote. Never compute, estimate, or round them.
- Do not infer an acceptance rate or selectivity from words like "competitive". Only report numbers the text states.
- Dates: copy them as written into *_text fields; do not convert them.
- Recruiting stages: "label" must be the stage's name copied verbatim from the text (e.g. "Coffee Chats"); omit stages the text doesn't name.
- join_modes: "comp" only when the text describes a comp; "open" only when it says anyone can join / no application.
- recruiting_seasons: only when the text says the club USUALLY recruits in given terms ("we recruit every fall", "comps run each semester" = fall and spring, "rolling basis" = rolling). Not for a single dated cycle ("Fall 2026 applications").
- Ignore information about individual people (names, emails, bios).`;

export function userPrompt(clubName: string, pages: { url: string; role: string; text: string }[]): string {
  const body = pages.map((p) => `<page url="${p.url}" role="${p.role}">\n${p.text}\n</page>`).join("\n\n");
  return `Organization: ${clubName}\n\nExtract facts about this organization from the following page text.\n\n${body}`;
}
