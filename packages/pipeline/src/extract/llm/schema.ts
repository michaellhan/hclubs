import { z } from "zod";
import { CLASS_YEARS, JOIN_MODES, STAGE_KINDS } from "@hci/core";

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
        term_text: z.string().nullable().describe("Term as written, e.g. 'Fall 2026'. Null if not stated."),
        opens_text: z.string().nullable().describe("Opening date as written. Null if not stated."),
        deadline_text: z
          .string()
          .nullable()
          .describe("Deadline as written, e.g. 'September 18 at 11:59 PM'. Null if not stated."),
        stages: z.array(z.object({ kind: z.enum(STAGE_KINDS), label: z.string().max(120).nullable() })).max(10),
        quote: Quote,
      }),
    )
    .max(4),
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
  activities: z.array(z.object({ value: z.string().max(120), quote: Quote })).max(12),
  sponsors: z.array(z.object({ value: z.string().max(80), quote: Quote })).max(20),
});
export type LlmExtraction = z.infer<typeof LlmExtraction>;

export const PROMPT_VERSION = "club-extract-v1";

export const SYSTEM_PROMPT = `You extract structured facts about a student organization from web page text.

Rules:
- Use ONLY the provided text. Do not use outside knowledge about Harvard or any organization.
- If a field is not explicitly supported by the text, return null (or an empty list). Missing is correct; guessing is wrong.
- Every value must include "quote": an exact, verbatim, contiguous excerpt copied from the text that states it. Do not paraphrase quotes.
- Numbers (member counts, applicants, hours, dues, percentages) must appear literally in the quote. Never compute, estimate, or round them.
- Do not infer an acceptance rate or selectivity from words like "competitive". Only report numbers the text states.
- Dates: copy them as written into *_text fields; do not convert them.
- join_modes: "comp" only when the text describes a comp; "open" only when it says anyone can join / no application.
- Ignore information about individual people (names, emails, bios).`;

export function userPrompt(clubName: string, pages: { url: string; role: string; text: string }[]): string {
  const body = pages.map((p) => `<page url="${p.url}" role="${p.role}">\n${p.text}\n</page>`).join("\n\n");
  return `Organization: ${clubName}\n\nExtract facts about this organization from the following page text.\n\n${body}`;
}
