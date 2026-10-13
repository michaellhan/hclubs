import { describe, expect, it } from "vitest";
import {
  emptyLlmStats,
  extractWithLlm,
  groundExtraction,
  joinModeGrounded,
  type CachedExtraction,
  type CacheKey,
  type ExtractionCacheStore,
  type LlmPage,
} from "../src/extract/llm/extractor";
import {
  costFor,
  type LlmProvider,
  type StructuredRequest,
  type StructuredResponse,
} from "../src/extract/llm/provider";
import { JSON_SHAPE, LlmExtraction } from "../src/extract/llm/schema";
import { parseJsonObject } from "../src/extract/llm/anthropic";
import { silentLogger } from "../src/logger";

const FETCHED = new Date("2026-09-30T16:00:00Z");
const PAGE: LlmPage = {
  url: "https://example-robotics.test/join",
  role: "join",
  snapshotId: "snap-1",
  text: [
    "# Join the team",
    "Our Fall 2026 application process has three stages: a short written application, a coffee chat, and a technical interview.",
    "Applications close October 3, 2026 at 11:59 PM ET.",
    "New members spend about 6-8 hours per week.",
    "In Fall 2025 we received 180 applicants and accepted 30 new members.",
    "We have over 60 members.",
  ].join("\n"),
};

const empty = (): LlmExtraction => ({
  short_description: null,
  mission: null,
  join_modes: [],
  eligible_classes: null,
  prior_experience: null,
  hours_per_week: null,
  member_count: null,
  dues: null,
  recruiting: [],
  recruiting_seasons: null,
  selectivity: [],
  activities: [],
  sponsors: [],
});

/** Scripted provider: returns queued responses, records requests. */
class FakeProvider implements LlmProvider {
  readonly name = "fake";
  readonly model = "claude-opus-5-5";
  calls: StructuredRequest<unknown>[] = [];
  constructor(private readonly queue: StructuredResponse<LlmExtraction>[]) {}
  async complete<T>(req: StructuredRequest<T>): Promise<StructuredResponse<T>> {
    this.calls.push(req as StructuredRequest<unknown>);
    const next = this.queue.shift() ?? { ok: false as const, error: "exhausted", retryable: false, usage: null };
    return next as unknown as StructuredResponse<T>;
  }
}
const ok = (output: LlmExtraction): StructuredResponse<LlmExtraction> => ({
  ok: true,
  output,
  usage: { inputTokens: 1000, outputTokens: 200, costUsd: costFor("claude-opus-5-5", 1000, 200) },
});

class MemoryCache implements ExtractionCacheStore {
  store = new Map<string, CachedExtraction>();
  async get(k: CacheKey) {
    return this.store.get(JSON.stringify(k)) ?? null;
  }
  async put(k: CacheKey, v: CachedExtraction) {
    this.store.set(JSON.stringify(k), v);
  }
}

describe("groundExtraction (anti-hallucination)", () => {
  it("accepts values whose verbatim quote and numbers appear in the text", () => {
    const out = empty();
    out.hours_per_week = { min: 6, max: 8, during_comp: false, quote: "New members spend about 6-8 hours per week." };
    out.recruiting = [
      {
        term_text: "Fall 2026",
        opens_text: null,
        deadline_text: "October 3, 2026 at 11:59 PM ET",
        stages: [
          { kind: "written_application", label: "short written application" },
          { kind: "coffee_chat", label: "coffee chat" },
          { kind: "technical_interview", label: "technical interview" },
        ],
        quote: "Applications close October 3, 2026 at 11:59 PM ET.",
      },
    ];
    out.selectivity = [
      {
        term_text: "Fall 2025",
        applicants: 180,
        interviewed: null,
        offers: null,
        accepted: 30,
        acceptance_rate_percent: null,
        quote: "In Fall 2025 we received 180 applicants and accepted 30 new members.",
      },
    ];
    const r = groundExtraction(out, [PAGE], FETCHED);
    const fields = r.claims.map((c) => c.fieldKey);
    expect(fields).toEqual(
      expect.arrayContaining([
        "club.hours_per_week",
        "cycle.deadline",
        "cycle.stages",
        "cycle.applicants",
        "cycle.admits",
      ]),
    );
    expect(r.claims.find((c) => c.fieldKey === "cycle.deadline")).toMatchObject({
      value: { at: "2026-10-03T23:59:00-04:00" },
      extractionMethod: "llm",
      snapshotId: "snap-1",
    });
    expect(r.claims.find((c) => c.fieldKey === "cycle.applicants")?.cycleTermKey).toBe("2025-fall");
    expect(r.rejected).toEqual([]);
  });

  it("reads a time range's opening as its START, never its end (g11)", () => {
    for (const [range, hour] of [
      ["12:30-2:30PM", "12:30:00"],
      ["12:30pm-2:30pm", "12:30:00"],
      ["7-9pm", "19:00:00"],
    ] as const) {
      const quote = `FALL 2026 Auditions will take place: Saturday September 5, ${range} | Farkas Hall`;
      const page: LlmPage = { ...PAGE, text: quote };
      const out = empty();
      out.recruiting = [
        {
          term_text: "FALL 2026",
          opens_text: `Saturday September 5, ${range}`,
          deadline_text: null,
          stages: [],
          quote,
        },
      ];
      const opens = groundExtraction(out, [page], FETCHED).claims.find((c) => c.fieldKey === "cycle.opens_at");
      expect((opens?.value as { at: string }).at).toBe(`2026-09-05T${hour}-04:00`);
    }
  });

  it("keeps only recruiting stages named verbatim in the text", () => {
    const out = empty();
    out.recruiting = [
      {
        term_text: "Fall 2026",
        opens_text: null,
        deadline_text: "October 3, 2026 at 11:59 PM ET",
        stages: [
          { kind: "written_application", label: "short written application" }, // in the text
          { kind: "case_interview", label: "Case Interview Round" }, // not in the text
          { kind: "coffee_chat", label: null }, // unlabeled: can't be checked
        ],
        quote: "Applications close October 3, 2026 at 11:59 PM ET.",
      },
    ];
    const r = groundExtraction(out, [PAGE], FETCHED);
    const stages = r.claims.find((c) => c.fieldKey === "cycle.stages")?.value;
    expect(stages).toEqual([{ order: 1, kind: "written_application", label: "short written application" }]);
    expect(r.rejected.join(" ")).toMatch(/2 stage\(s\) not stated verbatim/);
  });

  it("never shows a stage as a case or technical interview its label doesn't name (round 5, HUCG)", () => {
    const page: LlmPage = {
      ...PAGE,
      text: "#### First Round Interview\nFit questions.\n#### Second Round Interview\nGive a 5-minute presentation on a mock business problem.\nApplications close October 3, 2026 at 11:59 PM ET.",
    };
    const out = empty();
    out.recruiting = [
      {
        term_text: "Fall 2026",
        opens_text: null,
        deadline_text: "October 3, 2026 at 11:59 PM ET",
        stages: [
          { kind: "interview", label: "First Round Interview" },
          { kind: "case_interview", label: "Second Round Interview" },
        ],
        quote: "Applications close October 3, 2026 at 11:59 PM ET.",
      },
    ];
    const stages = groundExtraction(out, [page], FETCHED).claims.find((c) => c.fieldKey === "cycle.stages")?.value;
    expect(stages).toEqual([
      { order: 1, kind: "interview", label: "First Round Interview" },
      { order: 2, kind: "interview", label: "Second Round Interview" },
    ]);
    // The original fixture's "technical interview" is named, so it stays specific.
    const named = empty();
    named.recruiting = [
      {
        term_text: "Fall 2026",
        opens_text: null,
        deadline_text: "October 3, 2026 at 11:59 PM ET",
        stages: [{ kind: "technical_interview", label: "technical interview" }],
        quote: "Applications close October 3, 2026 at 11:59 PM ET.",
      },
    ];
    const kept = groundExtraction(named, [PAGE], FETCHED).claims.find((c) => c.fieldKey === "cycle.stages")?.value;
    expect(kept).toEqual([{ order: 1, kind: "technical_interview", label: "technical interview" }]);
  });

  it("rejects paraphrased/hallucinated quotes", () => {
    const out = empty();
    out.short_description = { value: "A robotics team", quote: "We are the best robotics team at Harvard." };
    const r = groundExtraction(out, [PAGE], FETCHED);
    expect(r.claims).toEqual([]);
    expect(r.rejected[0]).toMatch(/quote not found/);
  });

  it("rejects numbers that are not literally in the quote (no computing, no rounding)", () => {
    const out = empty();
    out.member_count = { exact: 65, min: null, max: null, quote: "We have over 60 members." };
    out.selectivity = [
      {
        term_text: "Fall 2025",
        applicants: 180,
        interviewed: null,
        offers: null,
        accepted: 30,
        acceptance_rate_percent: 16.7,
        quote: "In Fall 2025 we received 180 applicants and accepted 30 new members.",
      },
    ];
    const r = groundExtraction(out, [PAGE], FETCHED);
    expect(r.claims.some((c) => c.fieldKey === "club.member_count")).toBe(false);
    expect(r.claims.some((c) => c.fieldKey === "cycle.stated_acceptance_rate")).toBe(false); // 16.7 was computed, not stated
    expect(r.claims.some((c) => c.fieldKey === "cycle.applicants")).toBe(true);
    expect(r.rejected.join(" ")).toMatch(/65 does not appear in the quoted text/);
  });

  it("does not attach selectivity numbers without an explicit term", () => {
    const out = empty();
    out.selectivity = [
      {
        term_text: null,
        applicants: 180,
        interviewed: null,
        offers: null,
        accepted: 30,
        acceptance_rate_percent: null,
        quote: "In Fall 2025 we received 180 applicants and accepted 30 new members.",
      },
    ];
    expect(groundExtraction(out, [PAGE], FETCHED).claims).toEqual([]);
  });

  it("accepts quotes despite curly quotes / whitespace differences", () => {
    const out = empty();
    out.hours_per_week = { min: 6, max: 8, during_comp: false, quote: "New members spend about 6-8   hours per week." };
    expect(groundExtraction(out, [PAGE], FETCHED).claims).toHaveLength(1);
  });
});

describe("extractWithLlm (provider abstraction, retries, cache, budget)", () => {
  const good = empty();
  good.hours_per_week = { min: 6, max: 8, during_comp: false, quote: "New members spend about 6-8 hours per week." };

  it("retries malformed output, then succeeds; records usage and cost", async () => {
    const provider = new FakeProvider([
      {
        ok: false,
        error: "schema validation failed",
        retryable: true,
        usage: { inputTokens: 1000, outputTokens: 50, costUsd: 0.005 },
      },
      ok(good),
    ]);
    const stats = emptyLlmStats();
    const claims = await extractWithLlm(
      { clubName: "Example", pages: [PAGE], fetchedAt: FETCHED },
      { provider, cache: null, budget: { limitUsd: 1, spentUsd: 0 }, stats, dryRun: false, logger: silentLogger },
    );
    expect(provider.calls).toHaveLength(2);
    expect(claims.map((c) => c.fieldKey)).toEqual(["club.hours_per_week"]);
    expect(stats.calls).toBe(2);
    expect(stats.costUsd).toBeGreaterThan(0.008);
  });

  it("the prompt contains only the provided page text and the grounding rules", async () => {
    const provider = new FakeProvider([ok(empty())]);
    await extractWithLlm(
      { clubName: "Example", pages: [PAGE], fetchedAt: FETCHED },
      {
        provider,
        cache: null,
        budget: { limitUsd: 1, spentUsd: 0 },
        stats: emptyLlmStats(),
        dryRun: false,
        logger: silentLogger,
      },
    );
    const req = provider.calls[0]!;
    expect(req.system).toMatch(/Use ONLY the provided text/);
    expect(req.system).toMatch(/Missing is correct; guessing is wrong/);
    expect(req.user).toContain(PAGE.text);
  });

  it("gives up on non-retryable errors (e.g. refusal) and logs a failure", async () => {
    const provider = new FakeProvider([{ ok: false, error: "refusal", retryable: false, usage: null }]);
    const stats = emptyLlmStats();
    const claims = await extractWithLlm(
      { clubName: "Example", pages: [PAGE], fetchedAt: FETCHED },
      { provider, cache: null, budget: { limitUsd: 1, spentUsd: 0 }, stats, dryRun: false, logger: silentLogger },
    );
    expect(claims).toEqual([]);
    expect(stats.failures).toBe(1);
    expect(provider.calls).toHaveLength(1);
  });

  it("caches results: the second run makes no calls", async () => {
    const cache = new MemoryCache();
    const deps = { cache, budget: { limitUsd: 1, spentUsd: 0 }, dryRun: false, logger: silentLogger };
    await extractWithLlm(
      { clubName: "Example", pages: [PAGE], fetchedAt: FETCHED },
      { ...deps, provider: new FakeProvider([ok(good)]), stats: emptyLlmStats() },
    );
    const second = new FakeProvider([]);
    const stats = emptyLlmStats();
    const claims = await extractWithLlm(
      { clubName: "Example", pages: [PAGE], fetchedAt: FETCHED },
      { ...deps, provider: second, stats },
    );
    expect(second.calls).toHaveLength(0);
    expect(stats.cacheHits).toBe(1);
    expect(claims).toHaveLength(1);
  });

  it("dry run estimates tokens without calling; budget stops calls", async () => {
    const provider = new FakeProvider([ok(good)]);
    const stats = emptyLlmStats();
    await extractWithLlm(
      { clubName: "Example", pages: [PAGE], fetchedAt: FETCHED },
      { provider, cache: null, budget: { limitUsd: 1, spentUsd: 0 }, stats, dryRun: true, logger: silentLogger },
    );
    expect(provider.calls).toHaveLength(0);
    expect(stats.dryRunEstimatedTokens).toBeGreaterThan(100);

    const broke = emptyLlmStats();
    await extractWithLlm(
      { clubName: "Example", pages: [PAGE], fetchedAt: FETCHED },
      {
        provider,
        cache: null,
        budget: { limitUsd: 1, spentUsd: 1 },
        stats: broke,
        dryRun: false,
        logger: silentLogger,
      },
    );
    expect(provider.calls).toHaveLength(0);
    expect(broke.skippedForBudget).toBe(1);
  });
});

describe("JSON reply format", () => {
  it("keeps the first ten recruiting stages instead of failing the page", () => {
    const stage = { kind: "interview", label: null };
    const parsed = LlmExtraction.safeParse({
      ...empty(),
      recruiting: [
        {
          term_text: null,
          opens_text: null,
          deadline_text: null,
          stages: Array(12).fill(stage),
          quote: "Interviews in rounds",
        },
      ],
    });
    expect(parsed.success).toBe(true);
    if (parsed.success) expect(parsed.data.recruiting[0]?.stages).toHaveLength(10);
  });

  it("the prompt's JSON shape names exactly the schema's fields", () => {
    const shapeKeys = [...JSON_SHAPE.matchAll(/^ {2}"(\w+)":/gm)].map((m) => m[1]);
    expect(shapeKeys).toEqual(Object.keys(LlmExtraction.shape));
  });

  it("parses a JSON object out of a reply, with or without a code fence", () => {
    expect(parseJsonObject('```json\n{"a": 1}\n```')).toEqual({ a: 1 });
    expect(parseJsonObject("no json here")).toBeUndefined();
    expect(parseJsonObject("{broken")).toBeUndefined();
  });

  it("the extractor asks for JSON text and validates with the full schema", async () => {
    const provider = new FakeProvider([ok(empty())]);
    await extractWithLlm(
      { clubName: "Example", pages: [PAGE], fetchedAt: FETCHED },
      {
        provider,
        cache: null,
        budget: { limitUsd: 1, spentUsd: 0 },
        stats: emptyLlmStats(),
        dryRun: false,
        logger: silentLogger,
      },
    );
    expect(provider.calls[0]?.schema).toBe(LlmExtraction);
    expect(provider.calls[0]?.jsonShape).toBe(JSON_SHAPE);
  });
});

describe("join-mode grounding", () => {
  it("does not read 'no comp' as open membership", () => {
    expect(joinModeGrounded("open", "Southie After School does NOT have a comp process")).toBe(false);
    expect(joinModeGrounded("open", "There is no comp: anyone can join at any time.")).toBe(true);
    expect(joinModeGrounded("open", "No application required, just show up!")).toBe(true);
    expect(joinModeGrounded("comp", "Our comp runs six weeks.")).toBe(true);
  });
});

describe("join-mode grounding (open wording)", () => {
  it("keeps open when the text also says anyone can come", () => {
    expect(joinModeGrounded("open", "It’s easy—just show up! No auditions or experience required!")).toBe(true);
    expect(joinModeGrounded("open", 'Currently we have no "comp" process, just email us if you want to join')).toBe(
      true,
    );
  });
});

describe("grounding g13: people and show blurbs", () => {
  const page: LlmPage = {
    url: "https://modern-dance.test/our-shows",
    role: "other",
    snapshotId: "snap-shows",
    text: [
      "Spring 2024 the late hour Life tells us to rush. At the core of our spring 2024 show, we aim to visualize time.",
      "Directed by Jane Roe '25 and Mara Quill '25.",
      "We teach weekly company classes.",
    ].join("\n"),
  };
  it("rejects a mission that is a show blurb and activities that name people", () => {
    const out = empty();
    out.mission = {
      value: "At the core of our spring 2024 show, we aim to visualize time.",
      quote: "At the core of our spring 2024 show, we aim to visualize time.",
    };
    out.activities = [
      { value: "spring show directed by Jane Roe '25", quote: "Directed by Jane Roe '25 and Mara Quill '25." },
      { value: "weekly company classes", quote: "We teach weekly company classes." },
    ];
    const r = groundExtraction(out, [page], FETCHED, ["Example Modern Dance Company"]);
    expect(r.claims.map((c) => [c.fieldKey, c.value])).toEqual([["club.activity", "weekly company classes"]]);
    expect(r.rejected).toEqual([
      expect.stringMatching(/^club\.mission: describes one production/),
      expect.stringMatching(/^club\.activity: names a person with a class year/),
    ]);
  });
});
