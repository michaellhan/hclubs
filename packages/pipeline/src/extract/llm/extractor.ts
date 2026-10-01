import { createHash } from "node:crypto";
import {
  duesProblem,
  eventDateProblem,
  outsiderApplicationProblem,
  hoursProblem,
  memberCountProblem,
  openMembershipProblem,
  weekdayProblem,
} from "../evidence-rules";
import { parseDateExpression, parseTermExpression, termForDate, termKey } from "@hci/core";
import { dateFitsTerm } from "../deterministic";
import { latestYearIn } from "../../recruiting/signals";
import type { Logger } from "../../logger";
import type { ExtractedClaim } from "../../types";
import { estimateTokens, type LlmProvider, type LlmUsage } from "./provider";
import { JSON_SHAPE, LlmExtraction, PROMPT_VERSION, SYSTEM_PROMPT, userPrompt } from "./schema";

/**
 * LLM extraction with discipline (CLAUDE.md §11.3):
 *  - only cleaned text of pre-selected pages, chunked; never whole websites
 *  - schema-constrained output validated with Zod; bounded retries on malformed output
 *  - every value's quote must occur verbatim in the page text; numbers and dates must
 *    appear literally in the quote — otherwise the value is rejected and counted
 *  - results cached by (text hash, prompt version, provider, model); per-run budget
 */
/**
 * Grounding rules revision. Bumped when `groundExtraction` gets stricter without a prompt
 * change: cached model output stays valid (the cache is keyed by PROMPT_VERSION), and
 * `retract-unreproduced` removes claims the stricter rules no longer produce.
 */
export const GROUNDING_REVISION = "g6";
export const LLM_EXTRACTOR = { name: "site-llm", version: `${PROMPT_VERSION}+${GROUNDING_REVISION}` } as const;

/** "Does not have a comp" says nothing about whether anyone can join. */
const NEGATED_PROCESS = /\b(no|not|n['’]t|without)\b[^.;]{0,40}\b(comp|comps|comping|audition|auditions|tryouts?)\b/i;
const OPEN_WORDING: RegExp[] = [
  /\b(anyone|everyone|all (students|undergraduates))\b/i,
  /\b(all|everyone) (are |is )?welcome\b/i,
  /\bopen to (all|any)\b/i,
  /\b(no|without (an )?)application\b/i,
  /\bno\b[^.;!]{0,40}\b(experience|auditions?)\b[^.;!]{0,20}\b(required|needed|necessary)\b/i,
  /\bjust (show up|come|email|reach out|join|sign up)\b/i,
  /\bdrop[- ]in\b/i,
];

/** A join mode must be what the quote actually says (see NEGATED_PROCESS). */
export function joinModeGrounded(mode: string, quote: string): boolean {
  if (mode !== "open") return true;
  return !NEGATED_PROCESS.test(quote) || OPEN_WORDING.some((re) => re.test(quote));
}

export interface LlmPage {
  url: string;
  role: string;
  text: string;
  snapshotId: string;
}

export interface CachedExtraction {
  status: "ok" | "invalid" | "error";
  output: LlmExtraction | null;
  usage: LlmUsage | null;
  error: string | null;
}

export interface ExtractionCacheStore {
  get(key: CacheKey): Promise<CachedExtraction | null>;
  put(key: CacheKey, value: CachedExtraction & { attempts: number; snapshotId: string | null }): Promise<void>;
}

export interface CacheKey {
  textSha256: string;
  extractor: string;
  promptVersion: string;
  provider: string;
  model: string;
}

export interface LlmBudget {
  limitUsd: number;
  spentUsd: number;
}

export interface LlmRunStats {
  calls: number;
  cacheHits: number;
  failures: number;
  inputTokens: number;
  outputTokens: number;
  costUsd: number;
  rejectedValues: number;
  skippedForBudget: number;
  dryRunEstimatedTokens: number;
}

export const emptyLlmStats = (): LlmRunStats => ({
  calls: 0,
  cacheHits: 0,
  failures: 0,
  inputTokens: 0,
  outputTokens: 0,
  costUsd: 0,
  rejectedValues: 0,
  skippedForBudget: 0,
  dryRunEstimatedTokens: 0,
});

const MAX_CHUNK_CHARS = 40_000;
const MAX_ATTEMPTS = 3;

/** Normalize for quote matching: case, whitespace, curly quotes and dashes. */
export function normalizeForMatch(s: string): string {
  return s.toLowerCase().replace(/[‘’ʼ]/g, "'").replace(/[“”]/g, '"').replace(/[–—]/g, "-").replace(/\s+/g, " ").trim();
}

function numbersIn(s: string): Set<string> {
  return new Set([...s.replace(/(\d),(\d{3})/g, "$1$2").matchAll(/\d+(?:\.\d+)?/g)].map((m) => m[0]));
}

export function chunkPages(pages: LlmPage[]): LlmPage[][] {
  const chunks: LlmPage[][] = [];
  let current: LlmPage[] = [];
  let size = 0;
  for (const p of pages) {
    const text = p.text.slice(0, MAX_CHUNK_CHARS);
    if (size + text.length > MAX_CHUNK_CHARS && current.length > 0) {
      chunks.push(current);
      current = [];
      size = 0;
    }
    current.push({ ...p, text });
    size += text.length;
  }
  if (current.length > 0) chunks.push(current);
  return chunks;
}

/** Turn a validated LLM output into claims, rejecting anything not grounded in the text. */
export function groundExtraction(
  out: LlmExtraction,
  pages: LlmPage[],
  fetchedAt: Date,
): { claims: (ExtractedClaim & { snapshotId: string })[]; rejected: string[] } {
  const normPages = pages.map((p) => ({ page: p, norm: normalizeForMatch(p.text) }));
  const claims: (ExtractedClaim & { snapshotId: string })[] = [];
  const rejected: string[] = [];

  const locate = (quote: string) => {
    const q = normalizeForMatch(quote);
    return q.length >= 3 ? (normPages.find((p) => p.norm.includes(q))?.page ?? null) : null;
  };
  const add = (
    fieldKey: ExtractedClaim["fieldKey"],
    value: unknown,
    quote: string,
    numbers: (number | null)[] = [],
    extra: Partial<ExtractedClaim> = {},
  ) => {
    const page = locate(quote);
    if (!page) return rejected.push(`${fieldKey}: quote not found in text`);
    const inQuote = numbersIn(quote);
    for (const n of numbers) {
      if (n === null) continue;
      if (!inQuote.has(String(n))) return rejected.push(`${fieldKey}: number ${n} not in quote`);
    }
    claims.push({
      fieldKey,
      value,
      assertionKind: "stated",
      isDirect: true,
      extractionMethod: "llm",
      quote,
      locator: { url: page.url, role: page.role },
      snapshotId: page.snapshotId,
      ...extra,
    });
    return undefined;
  };

  if (out.short_description) add("club.short_description", out.short_description.value, out.short_description.quote);
  if (out.mission) add("club.mission", out.mission.value, out.mission.quote);
  for (const j of out.join_modes) {
    if (!joinModeGrounded(j.value, j.quote)) {
      rejected.push(`club.join_mode: "${j.value}" not supported by its quote`);
      continue;
    }
    const openProblem = j.value === "open" ? openMembershipProblem(j.quote) : null;
    if (openProblem) {
      rejected.push(`club.join_mode: ${openProblem.why}`);
      continue;
    }
    add("club.join_mode", j.value, j.quote);
  }
  if (out.eligible_classes)
    add("club.eligible_classes", [...new Set(out.eligible_classes.value)], out.eligible_classes.quote);
  if (out.recruiting_seasons) {
    const seasons = [...new Set(out.recruiting_seasons.value)].sort();
    // Each season must be named in the quote ("semester" covers fall + spring).
    const q = out.recruiting_seasons.quote.toLowerCase();
    const named = (r: string) =>
      r === "rolling"
        ? /rolling|year-round/.test(q)
        : q.includes(r === "fall" ? "fall" : r) ||
          (r === "fall" && q.includes("autumn")) ||
          (["fall", "spring"].includes(r) && /semester/.test(q));
    if (seasons.every(named)) add("club.recruiting_seasons", seasons, out.recruiting_seasons.quote);
    else rejected.push(`club.recruiting_seasons: ${seasons.join(",")} not named in its quote`);
  }
  if (out.prior_experience) add("club.experience_required", out.prior_experience.value, out.prior_experience.quote);
  const hp = out.hours_per_week;
  const hoursIssue = hp
    ? hoursProblem(
        hp.quote,
        [hp.min, hp.max].filter((n): n is number => n !== null),
      )
    : null;
  if (hoursIssue) rejected.push(`club.hours_per_week: ${hoursIssue.why}`);
  else if (out.hours_per_week && (out.hours_per_week.min !== null || out.hours_per_week.max !== null)) {
    const h = out.hours_per_week;
    add(
      "club.hours_per_week",
      { min: h.min, max: h.max, ...(h.during_comp ? { qualifier: "comp_period" } : {}) },
      h.quote,
      [h.min, h.max],
    );
  }
  const mc = out.member_count;
  const memberIssue = mc
    ? memberCountProblem(
        mc.quote,
        [mc.exact, mc.min, mc.max].filter((n): n is number => n !== null),
      )
    : null;
  if (memberIssue) rejected.push(`club.member_count: ${memberIssue.why}`);
  else if (out.member_count) {
    const m = out.member_count;
    if (m.exact !== null) add("club.member_count", { kind: "exact", count: m.exact }, m.quote, [m.exact]);
    else if (m.min !== null || m.max !== null)
      add("club.member_count", { kind: "range", min: m.min, max: m.max }, m.quote, [m.min, m.max]);
  }
  const duesIssue = out.dues ? duesProblem(out.dues.quote, out.dues.amount_usd) : null;
  if (duesIssue) rejected.push(`club.dues: ${duesIssue.why}`);
  else if (out.dues)
    add("club.dues", { hasDues: out.dues.has_dues, amountUsd: out.dues.amount_usd }, out.dues.quote, [
      out.dues.amount_usd,
    ]);
  for (const a of out.activities) add("club.activity", a.value, a.quote);
  for (const s of out.sponsors) add("club.sponsor", s.value, s.quote);

  for (const r of out.recruiting) {
    const qn = normalizeForMatch(r.quote);
    const inQuote = (t: string | null) => t !== null && qn.includes(normalizeForMatch(t));
    const recPage = locate(r.quote);
    const stale = recPage ? latestYearIn(recPage.text, recPage.url, fetchedAt).stale : false;
    // Same date rules as the deterministic extractor: no "this Friday" against the crawl
    // date, and no guessed year on a page whose latest year is already past.
    const usable = (d: ReturnType<typeof parseDateExpression>) => {
      if (!d) return null;
      if (d.notes.some((n) => n.startsWith("relative weekday"))) return null;
      if (stale && d.notes.some((n) => n.startsWith("year inferred"))) return null;
      return d;
    };
    // A stated weekday that contradicts the date, or an event's date (ADR 0033).
    const checked = (text: string | null, d: ReturnType<typeof parseDateExpression>, opens: boolean) => {
      if (!d || !text) return d;
      if (weekdayProblem(text, d.at)) return null;
      if (eventDateProblem(opens ? r.quote : text) || eventDateProblem(r.quote)) return null;
      if (outsiderApplicationProblem(r.quote, recPage?.text ?? "")) return null;
      return d;
    };
    const deadline = checked(
      r.deadline_text,
      usable(r.deadline_text && inQuote(r.deadline_text) ? parseDateExpression(r.deadline_text, fetchedAt) : null),
      false,
    );
    const opens = checked(
      r.opens_text,
      usable(r.opens_text && inQuote(r.opens_text) ? parseDateExpression(r.opens_text, fetchedAt) : null),
      true,
    );
    const explicitTerm =
      r.term_text && inQuote(r.term_text) ? parseTermExpression(r.term_text, fetchedAt)?.termKey : undefined;
    const term =
      explicitTerm ?? (deadline ? termKey(termForDate(new Date(`${deadline.at.slice(0, 10)}T16:00:00Z`))) : undefined);
    if (!term) {
      rejected.push("recruiting: no term or date grounded in quote");
      continue;
    }
    if ((deadline && !dateFitsTerm(deadline.at, term)) || (opens && !dateFitsTerm(opens.at, term))) {
      rejected.push(`recruiting: date outside the ${term} recruiting window`);
      continue;
    }
    if (deadline)
      add(
        "cycle.deadline",
        {
          at: deadline.at,
          precision: deadline.precision,
          sourceText: deadline.originalText,
          parseConfidence: deadline.confidence,
        },
        r.quote,
        [],
        { cycleTermKey: term },
      );
    if (opens)
      add(
        "cycle.opens_at",
        { at: opens.at, precision: opens.precision, sourceText: opens.originalText, parseConfidence: opens.confidence },
        r.quote,
        [],
        { cycleTermKey: term },
      );
    // A stage is kept only if its label appears verbatim in the page text: the recruiting
    // quote grounds the cycle, not each stage (the model may attach stages to a date quote).
    const pageText = recPage ? normalizeForMatch(recPage.text) : "";
    const stages = r.stages.filter(
      (s) => s.label && s.label.length >= 3 && pageText.includes(normalizeForMatch(s.label)),
    );
    if (stages.length < r.stages.length)
      rejected.push(`cycle.stages: ${r.stages.length - stages.length} stage(s) not stated verbatim in the text`);
    if (stages.length > 0) {
      add(
        "cycle.stages",
        stages.map((s, i) => ({ order: i + 1, kind: s.kind, label: s.label })),
        r.quote,
        [],
        { cycleTermKey: term },
      );
    }
  }
  for (const s of out.selectivity) {
    const term =
      s.term_text && normalizeForMatch(s.quote).includes(normalizeForMatch(s.term_text))
        ? parseTermExpression(s.term_text, null)
        : null;
    if (!term) {
      rejected.push("selectivity: numbers without an explicit term are not attached to a cycle");
      continue;
    }
    const extra = { cycleTermKey: term.termKey };
    if (s.applicants !== null) add("cycle.applicants", s.applicants, s.quote, [s.applicants], extra);
    if (s.interviewed !== null) add("cycle.interviewees", s.interviewed, s.quote, [s.interviewed], extra);
    if (s.offers !== null) add("cycle.offers", s.offers, s.quote, [s.offers], extra);
    if (s.accepted !== null) add("cycle.admits", s.accepted, s.quote, [s.accepted], extra);
    if (s.acceptance_rate_percent !== null)
      add("cycle.stated_acceptance_rate", s.acceptance_rate_percent, s.quote, [s.acceptance_rate_percent], extra);
  }
  return { claims, rejected };
}

export async function extractWithLlm(
  input: { clubName: string; pages: LlmPage[]; fetchedAt: Date },
  deps: {
    provider: LlmProvider;
    cache: ExtractionCacheStore | null;
    budget: LlmBudget;
    stats: LlmRunStats;
    dryRun: boolean;
    logger: Logger;
  },
): Promise<(ExtractedClaim & { snapshotId: string })[]> {
  const { provider, cache, budget, stats, logger } = deps;
  const claims: (ExtractedClaim & { snapshotId: string })[] = [];
  for (const chunk of chunkPages(input.pages)) {
    const user = userPrompt(input.clubName, chunk);
    const key: CacheKey = {
      textSha256: createHash("sha256").update(user).digest("hex"),
      extractor: LLM_EXTRACTOR.name,
      promptVersion: PROMPT_VERSION,
      provider: provider.name,
      model: provider.model,
    };

    let output: LlmExtraction | null = null;
    const cached = cache ? await cache.get(key) : null;
    if (cached?.status === "ok" && cached.output) {
      stats.cacheHits++;
      output = cached.output;
    } else if (deps.dryRun) {
      stats.dryRunEstimatedTokens += estimateTokens(SYSTEM_PROMPT) + estimateTokens(user);
      continue;
    } else if (budget.spentUsd >= budget.limitUsd) {
      stats.skippedForBudget++;
      continue;
    } else {
      let lastError = "unknown";
      let attempts = 0;
      for (attempts = 1; attempts <= MAX_ATTEMPTS; attempts++) {
        stats.calls++;
        const res = await provider.complete({
          system: SYSTEM_PROMPT,
          user,
          schema: LlmExtraction,
          jsonShape: JSON_SHAPE,
          maxTokens: 8000,
        });
        if (res.usage) {
          stats.inputTokens += res.usage.inputTokens;
          stats.outputTokens += res.usage.outputTokens;
          stats.costUsd += res.usage.costUsd ?? 0;
          budget.spentUsd += res.usage.costUsd ?? 0;
        }
        if (res.ok) {
          output = res.output;
          await cache?.put(key, {
            status: "ok",
            output,
            usage: res.usage,
            error: null,
            attempts,
            snapshotId: chunk[0]?.snapshotId ?? null,
          });
          break;
        }
        lastError = res.error;
        logger.warn({ club: input.clubName, attempt: attempts, error: res.error }, "LLM extraction attempt failed");
        if (!res.retryable) break;
      }
      if (!output) {
        stats.failures++;
        await cache?.put(key, {
          status: "error",
          output: null,
          usage: null,
          error: lastError,
          attempts,
          snapshotId: chunk[0]?.snapshotId ?? null,
        });
        continue;
      }
    }
    const grounded = groundExtraction(output, chunk, input.fetchedAt);
    stats.rejectedValues += grounded.rejected.length;
    if (grounded.rejected.length)
      logger.debug({ club: input.clubName, rejected: grounded.rejected }, "ungrounded LLM values rejected");
    claims.push(...grounded.claims);
  }
  return claims;
}
