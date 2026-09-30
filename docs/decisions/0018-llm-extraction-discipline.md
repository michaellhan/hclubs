# 0018: LLM extraction is optional, grounded, cached and budgeted

**Status:** accepted (M2)

## Decision

- Deterministic extractors run first and always (`packages/pipeline/src/extract/deterministic.ts`).
- LLM extraction (`--llm`) sees only the cleaned text of up to 4 high-value pages per club (home/about/join/recruiting/faq), capped at 15k characters each and chunked at 40k.
- The output is schema-constrained (Anthropic structured outputs + Zod), with bounded retries on malformed or truncated output. Refusals and client errors are not retried.
- Every value must carry a verbatim quote that occurs in the page text. Numbers must appear literally in the quote, dates are parsed by our own parser from text inside the quote, and selectivity numbers need an explicit term. Anything else is rejected and counted (`llmRejectedValues`).
- Results are cached in `extraction_cache` by (input hash, prompt version, provider, model), which is also the token/cost ledger. Each run has a USD budget (`--budget`, `EXTRACTION_BUDGET_USD`), and `--llm-dry-run` reports what would be sent.
- The provider is an interface (`LlmProvider`), and the Anthropic implementation is one class. The default model is `claude-opus-5-5` at low effort, configurable via `EXTRACTION_MODEL` and `EXTRACTION_EFFORT`.

## Consequences

Enrichment works fully without an API key. Enabling the LLM can only add grounded claims labeled `extraction_method = llm`, never ungrounded ones.

## Update (2026-09-30, first live run)

- **Output format.** The Messages API's schema-constrained output rejected our extraction schema: first because the compiled grammar was too large, then for exceeding the limit of 16 nullable/union fields. The model is now asked for one JSON object in text, using a compact shape in the prompt (`JSON_SHAPE`, which a test keeps in sync with `LlmExtraction`). Replies are parsed and validated locally by `LlmExtraction`, and invalid output is retried. The grounding rules are unchanged.
- **Stricter stage grounding.** A recruiting stage is kept only if its label appears verbatim in the page text. The recruiting quote grounds the cycle, not each stage; the model had attached stages to a sentence that only gave dates.
- **Prompt version.** It is now `club-extract-v3`. The 3 claims produced only by v2 were retracted.
- **First run.**
  - Scale and cost: 74 calls, about 256k input and 54k output tokens, $2.10 on `claude-opus-5-5` at low effort.
  - Results: 499 new claims. 22 values were rejected by grounding, and 2 clubs failed after retries.
  - Spot check: sampled numbers and dates all matched their quotes.

## Update (2026-09-30, M3): grounding revisions

`LLM_EXTRACTOR.version` is now `<PROMPT_VERSION>+<GROUNDING_REVISION>`. Tightening `groundExtraction` (for example, "does not have a comp" no longer grounds `join_mode = open`) bumps only the grounding revision: the cache stays keyed by the prompt version, so a rerun replays stored model output for free. Then `retract-unreproduced --field=<keys>` rejects what the stricter rules drop, considering only claims whose own snapshot the new version re-extracted. Directory pages about a club (PBHA, IOP, Mignone, Wikipedia) are now also sent to the model, in a separate call from the club's own site pages; their claims carry the directory's tier.
