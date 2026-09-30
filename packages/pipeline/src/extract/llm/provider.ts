import type { z } from "zod";

/**
 * Provider-agnostic structured extraction. Implementations: Anthropic (./anthropic.ts),
 * and test fakes. Swap providers via EXTRACTION_PROVIDER without touching extractors.
 */
export interface LlmUsage {
  inputTokens: number;
  outputTokens: number;
  /** Null when the provider/model has no known price. */
  costUsd: number | null;
}

export interface StructuredRequest<T> {
  system: string;
  user: string;
  schema: z.ZodType<T>;
  maxTokens: number;
}

export type StructuredResponse<T> =
  { ok: true; output: T; usage: LlmUsage } | { ok: false; error: string; retryable: boolean; usage: LlmUsage | null };

export interface LlmProvider {
  readonly name: string;
  readonly model: string;
  complete<T>(request: StructuredRequest<T>): Promise<StructuredResponse<T>>;
}

/** Per-million-token prices (USD) for cost accounting. Update when prices change. */
export const MODEL_PRICES: Record<string, { input: number; output: number }> = {
  "claude-opus-5-5": { input: 4, output: 20 },
  "claude-sonnet-5-5": { input: 2, output: 10 },
  "claude-haiku-4-5": { input: 1, output: 5 },
  "claude-fable-5-1": { input: 10, output: 50 },
};

export function costFor(model: string, inputTokens: number, outputTokens: number): number | null {
  const p = MODEL_PRICES[model];
  if (!p) return null;
  return (inputTokens * p.input + outputTokens * p.output) / 1_000_000;
}

/** Rough token estimate for dry runs (≈4 chars/token for English prose). */
export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}
