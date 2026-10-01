/**
 * Kill switch for billable APIs (Anthropic, Brave Search). With `HCI_PAID_APIS=off` in the
 * environment, every paid provider refuses before it sends a request: cached LLM results
 * still replay, cache misses fail cleanly, and search stages stop as if credit ran out.
 * Use it for zero-cost development (docs/runbook.md) while real keys sit in `.env`.
 */
export function paidApisDisabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return /^(off|0|false|no)$/i.test((env.HCI_PAID_APIS ?? "").trim());
}

export class PaidApiDisabledError extends Error {
  constructor(service: string) {
    super(`${service} is a paid API and HCI_PAID_APIS=off: no request sent`);
  }
}
