import type { z } from "zod";

/**
 * Provider-agnostic structured extraction. Implementations: Anthropic (./anthropic.ts),
 * and test fakes. Swap providers via EXTRACTION_PROVIDER without touching extractors.
 */
export interface LlmUsage {
  /** Uncached input tokens (excludes cache reads and writes). */
  inputTokens: number;
  outputTokens: number;
  /** Prompt-cache tokens, when the provider caches the prompt prefix. */
  cacheReadTokens?: number;
  cacheWriteTokens?: number;
  /** Null when the provider/model has no known price. */
  costUsd: number | null;
}

export interface StructuredRequest<T> {
  system: string;
  user: string;
  /** Validates the output (may carry bounds the API format can't express). */
  schema: z.ZodType<T>;
  /**
   * Ask for JSON in text with this shape instead of schema-constrained output (for schemas
   * too large for the provider's constrained decoding). The reply is still validated by `schema`.
   */
  jsonShape?: string;
  maxTokens: number;
}

export type StructuredResponse<T> =
  { ok: true; output: T; usage: LlmUsage } | { ok: false; error: string; retryable: boolean; usage: LlmUsage | null };

export interface LlmProvider {
  readonly name: string;
  readonly model: string;
  complete<T>(request: StructuredRequest<T>): Promise<StructuredResponse<T>>;
}

/**
 * Per-million-token prices (USD) for cost accounting. Update when prices change.
 * `cacheRead` is the prompt-cache read price; cache writes (5-minute TTL) cost 1.25× input.
 */
export const MODEL_PRICES: Record<string, { input: number; output: number; cacheRead: number }> = {
  "claude-opus-5-5": { input: 4, output: 20, cacheRead: 0.2 },
  "claude-sonnet-5-5": { input: 2, output: 10, cacheRead: 0.2 },
  "claude-haiku-4-5": { input: 1, output: 5, cacheRead: 0.1 },
  "claude-fable-5-1": { input: 10, output: 50, cacheRead: 0.25 },
};

const CACHE_WRITE_MULTIPLIER = 1.25;

export function costFor(
  model: string,
  inputTokens: number,
  outputTokens: number,
  cache: { readTokens?: number; writeTokens?: number } = {},
): number | null {
  const p = MODEL_PRICES[model];
  if (!p) return null;
  const cached = (cache.readTokens ?? 0) * p.cacheRead + (cache.writeTokens ?? 0) * p.input * CACHE_WRITE_MULTIPLIER;
  return (inputTokens * p.input + outputTokens * p.output + cached) / 1_000_000;
}

/** Rough token estimate for dry runs (≈4 chars/token for English prose). */
export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

/**
 * Reserve the most a call could cost before sending it (input estimate + the full output
 * allowance), so concurrent workers can't all pass the budget check at once. Returns the
 * amount reserved, or null when the call doesn't fit, or the model has no known price
 * (fail closed: an unpriced model would otherwise count as free). Settle afterwards. PURE
 * apart from mutating `budget`.
 */
export function reserveBudget(
  budget: { limitUsd: number; spentUsd: number },
  model: string,
  promptText: string,
  maxOutputTokens: number,
): number | null {
  const worst = costFor(model, estimateTokens(promptText), maxOutputTokens);
  if (worst === null || !Number.isFinite(budget.limitUsd)) return null;
  if (budget.spentUsd + worst > budget.limitUsd) return null;
  budget.spentUsd += worst;
  return worst;
}

/** Replace a reservation with what the call actually cost (the reservation if unknown). */
export function settleBudget(budget: { spentUsd: number }, reserved: number, actualUsd: number | null): void {
  budget.spentUsd += (actualUsd ?? reserved) - reserved;
}
