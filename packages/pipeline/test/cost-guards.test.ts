import { afterEach, describe, expect, it } from "vitest";
import type Anthropic from "@anthropic-ai/sdk";
import { AnthropicProvider } from "../src/extract/llm/anthropic";
import { emptyLlmStats, extractWithLlm, type LlmPage } from "../src/extract/llm/extractor";
import {
  reserveBudget,
  settleBudget,
  type LlmProvider,
  type StructuredRequest,
  type StructuredResponse,
} from "../src/extract/llm/provider";
import { silentLogger } from "../src/logger";
import { paidApisDisabled } from "../src/paid";
import { BraveSearchProvider, SearchCreditError } from "../src/sites/search";

/**
 * Paid-API guardrails, with fakes only (no request ever leaves the test): the kill switch,
 * fail-closed pricing, budget reservation across concurrent workers and the search cap.
 */
const PAGE: LlmPage = {
  url: "https://club.example/join",
  role: "join",
  text: "Fictional Club. New members spend about 6-8 hours per week.",
  snapshotId: "00000000-0000-7000-8000-000000000001",
};

class SlowProvider implements LlmProvider {
  readonly name = "fake";
  calls = 0;
  constructor(readonly model = "claude-opus-5-5") {}
  async complete<T>(_req: StructuredRequest<T>): Promise<StructuredResponse<T>> {
    this.calls++;
    await new Promise((r) => setTimeout(r, 5));
    return {
      ok: false,
      error: "nope",
      retryable: false,
      usage: { inputTokens: 100, outputTokens: 10, costUsd: 0.001 },
    };
  }
}

afterEach(() => {
  delete process.env.HCI_PAID_APIS;
});

describe("HCI_PAID_APIS kill switch", () => {
  it("reads off/0/false/no as disabled", () => {
    for (const v of ["off", "OFF", "0", "false", "no"]) expect(paidApisDisabled({ HCI_PAID_APIS: v })).toBe(true);
    for (const v of [undefined, "", "on", "1"]) expect(paidApisDisabled({ HCI_PAID_APIS: v })).toBe(false);
  });

  it("stops Anthropic before the SDK is touched", async () => {
    process.env.HCI_PAID_APIS = "off";
    const client = new Proxy(
      {},
      {
        get: () => {
          throw new Error("SDK touched");
        },
      },
    ) as unknown as Anthropic;
    const provider = new AnthropicProvider("claude-opus-5-5", "low", client);
    const res = await provider.complete({ system: "s", user: "u", schema: {} as never, maxTokens: 10 });
    expect(res).toMatchObject({ ok: false, retryable: false, usage: null });
  });

  it("stops Brave before any request, as if credit ran out", async () => {
    process.env.HCI_PAID_APIS = "off";
    const brave = new BraveSearchProvider("key", silentLogger, 0, 20, 100);
    await expect(brave.search("harvard chess")).rejects.toBeInstanceOf(SearchCreditError);
    expect(brave.used).toBe(0);
  });
});

describe("budgets", () => {
  it("an unpriced model is refused, not counted as free", () => {
    expect(() => new AnthropicProvider("claude-unknown-9")).toThrow(/no price/);
    expect(reserveBudget({ limitUsd: 100, spentUsd: 0 }, "claude-unknown-9", "x", 100)).toBeNull();
  });

  it("reserves the worst case before awaiting, so concurrent workers can't overspend", async () => {
    // One worst-case call (8000 output tokens at $20/M ≈ $0.16) fits in $0.25; two don't.
    const budget = { limitUsd: 0.25, spentUsd: 0 };
    const provider = new SlowProvider();
    const run = () =>
      extractWithLlm(
        { clubName: "Fictional Club", pages: [PAGE], fetchedAt: new Date("2026-10-01") },
        { provider, cache: null, budget, stats: emptyLlmStats(), dryRun: false, logger: silentLogger },
      );
    await Promise.all([run(), run(), run(), run()]);
    expect(provider.calls).toBe(1);
    expect(budget.spentUsd).toBeLessThanOrEqual(0.25);
    expect(budget.spentUsd).toBeCloseTo(0.001, 5);
  });

  it("settles a reservation to the real cost, or keeps it when the cost is unknown", () => {
    const b = { limitUsd: 1, spentUsd: 0 };
    const r = reserveBudget(b, "claude-sonnet-5-5", "hello", 1000);
    expect(r).not.toBeNull();
    settleBudget(b, r ?? 0, 0.0002);
    expect(b.spentUsd).toBeCloseTo(0.0002, 6);
    const r2 = reserveBudget(b, "claude-sonnet-5-5", "hello", 1000) ?? 0;
    settleBudget(b, r2, null);
    expect(b.spentUsd).toBeCloseTo(0.0002 + r2, 6);
  });

  it("caps paid search queries per run", async () => {
    const brave = new BraveSearchProvider("key", silentLogger, 0, 20, 0);
    await expect(brave.search("anything")).rejects.toBeInstanceOf(SearchCreditError);
  });
});
