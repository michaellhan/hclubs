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
