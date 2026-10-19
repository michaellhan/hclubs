import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { paidApisDisabled } from "../../paid";
import { MODEL_PRICES, costFor, type LlmProvider, type StructuredRequest, type StructuredResponse } from "./provider";

export type Effort = "low" | "medium" | "high" | "xhigh" | "max";

/**
 * Anthropic implementation using structured outputs (`messages.parse` + Zod), so the
 * response is schema-constrained and parsed by the SDK. Credentials resolve the SDK's
 * standard way (ANTHROPIC_API_KEY, auth token, or `ant auth login` profile).
 */
export class AnthropicProvider implements LlmProvider {
  readonly name = "anthropic";
  private readonly client: Anthropic;

  constructor(
    readonly model: string = "claude-opus-5-5",
    private readonly effort: Effort = "low",
    client?: Anthropic,
  ) {
    // Fail closed: spend is counted from MODEL_PRICES, so an unpriced model would look free
    // and slip past every budget cap.
    if (!MODEL_PRICES[model]) throw new Error(`no price for model "${model}" in MODEL_PRICES; add it before use`);
    this.client = client ?? new Anthropic({ maxRetries: 3 });
  }

  async complete<T>(request: StructuredRequest<T>): Promise<StructuredResponse<T>> {
    // Checked per call, after the extractor's cache lookup, so cached results still replay.
    if (paidApisDisabled())
      return {
        ok: false,
        error: "HCI_PAID_APIS=off: Anthropic API disabled for this run",
        retryable: false,
        usage: null,
      };
    try {
      let raw: unknown;
      let response: Anthropic.Message;
      if (request.jsonShape) {
        response = await this.client.messages.create({
          model: this.model,
          max_tokens: request.maxTokens,
          system: cachedSystem(
            `${request.system}\n\nRespond with only one JSON object of this shape, and nothing else:\n${request.jsonShape}`,
          ),
          messages: [{ role: "user", content: request.user }],
          output_config: { effort: this.effort },
        });
        raw = parseJsonObject(response.content.map((b) => (b.type === "text" ? b.text : "")).join(""));
      } else {
        const parsedResponse = await this.client.messages.parse({
          model: this.model,
          max_tokens: request.maxTokens,
          system: cachedSystem(request.system),
          messages: [{ role: "user", content: request.user }],
          output_config: { effort: this.effort, format: zodOutputFormat(request.schema) },
        });
        response = parsedResponse;
        raw = parsedResponse.parsed_output;
      }
      const u = response.usage;
      const cacheReadTokens = u.cache_read_input_tokens ?? 0;
      const cacheWriteTokens = u.cache_creation_input_tokens ?? 0;
      const usage = {
        inputTokens: u.input_tokens,
        outputTokens: u.output_tokens,
        cacheReadTokens,
        cacheWriteTokens,
        costUsd: costFor(this.model, u.input_tokens, u.output_tokens, {
          readTokens: cacheReadTokens,
          writeTokens: cacheWriteTokens,
        }),
      };
      if (response.stop_reason === "refusal") {
        return {
          ok: false,
          error: `refusal (${response.stop_details?.category ?? "unspecified"})`,
          retryable: false,
          usage,
        };
      }
      if (response.stop_reason === "max_tokens") {
        return { ok: false, error: "output truncated at max_tokens", retryable: true, usage };
      }
      if (raw === undefined) return { ok: false, error: "no JSON object in response", retryable: true, usage };
      const parsed = request.schema.safeParse(raw);
      if (!parsed.success)
        return {
          ok: false,
          error: `schema validation failed: ${parsed.error.message.slice(0, 300)}`,
          retryable: true,
          usage,
        };
      return { ok: true, output: parsed.data, usage };
    } catch (error) {
      if (
        error instanceof Anthropic.RateLimitError ||
        error instanceof Anthropic.InternalServerError ||
        error instanceof Anthropic.APIConnectionError
      ) {
        return { ok: false, error: `${error.name}: ${error.message}`, retryable: true, usage: null };
      }
      if (error instanceof Anthropic.APIError) {
        return {
          ok: false,
          error: `API error ${String(error.status)}: ${error.message}`,
          retryable: false,
          usage: null,
        };
      }
      return { ok: false, error: error instanceof Error ? error.message : String(error), retryable: true, usage: null };
    }
  }
}

/**
 * The system prompt as one cached block: it is identical across a run's calls (only the user
 * text varies), so later calls read it from the prompt cache instead of paying full input price.
 */
function cachedSystem(text: string): Anthropic.TextBlockParam[] {
  return [{ type: "text", text, cache_control: { type: "ephemeral" } }];
}

/** The first top-level JSON object in a model reply (tolerates a code fence around it). */
export function parseJsonObject(text: string): unknown {
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start === -1 || end <= start) return undefined;
  try {
    return JSON.parse(text.slice(start, end + 1));
  } catch {
    return undefined;
  }
}
