/**
 * AWS Bedrock cost extractor.
 *
 * Bedrock billing follows each foundation model's on-demand token prices.
 * The InvokeModel response includes usage.inputTokens and usage.outputTokens.
 *
 * Usage:
 *   const res = await bedrockRuntime.invokeModel({ modelId: "...", body: "..." });
 *   ctx.reportActualCost(extractBedrockCost(res));
 */

// Prices in USD per 1,000 tokens (as of 2026-06)
const BEDROCK_PRICING: Record<string, { input: number; output: number }> = {
  // Anthropic on Bedrock
  "anthropic.claude-3-5-sonnet-20241022-v2:0": { input: 0.003,   output: 0.015   },
  "anthropic.claude-3-5-haiku-20241022-v1:0":  { input: 0.0008,  output: 0.004   },
  "anthropic.claude-3-opus-20240229-v1:0":      { input: 0.015,   output: 0.075   },
  // Meta Llama on Bedrock
  "meta.llama3-70b-instruct-v1:0":              { input: 0.00265, output: 0.0035  },
  "meta.llama3-8b-instruct-v1:0":               { input: 0.0003,  output: 0.0006  },
  // Amazon Titan
  "amazon.titan-text-express-v1":               { input: 0.0008,  output: 0.0016  },
  "amazon.titan-text-lite-v1":                  { input: 0.0003,  output: 0.0004  },
  // Mistral
  "mistral.mistral-large-2402-v1:0":            { input: 0.004,   output: 0.012   },
  "mistral.mistral-7b-instruct-v0:2":           { input: 0.00015, output: 0.0002  },
  // Cohere
  "cohere.command-r-plus-v1:0":                 { input: 0.003,   output: 0.015   },
  "cohere.command-r-v1:0":                      { input: 0.0005,  output: 0.0015  },
};

/**
 * Extract Bedrock invocation cost from the response.
 *
 * @param response - Raw InvokeModelResponse from @aws-sdk/client-bedrock-runtime
 * @param modelId  - Bedrock model ID (e.g. "anthropic.claude-3-5-sonnet-20241022-v2:0")
 *                   If omitted, extracted from response.modelId if available.
 */
export function extractBedrockCost(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  response: any,
  modelId?: string,
): number {
  try {
    const model = modelId ?? response?.modelId ?? response?.$metadata?.modelId ?? "";
    const pricing = BEDROCK_PRICING[model];
    if (!pricing) return 0; // Unknown model

    // The response body is a Uint8Array; parse it to find usage
    let body: Record<string, unknown> = {};
    if (response?.body instanceof Uint8Array) {
      body = JSON.parse(new TextDecoder().decode(response.body));
    } else if (typeof response?.body === "object" && response?.body !== null) {
      body = response.body as Record<string, unknown>;
    }

    // Anthropic format
    const anthropicUsage = body?.usage as { input_tokens?: number; output_tokens?: number } | undefined;
    if (anthropicUsage?.input_tokens != null) {
      return (
        (anthropicUsage.input_tokens  * pricing.input  / 1000) +
        ((anthropicUsage.output_tokens ?? 0) * pricing.output / 1000)
      );
    }

    // Amazon/Cohere/Meta format
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const inputTokens  = (body as any)?.inputTextTokenCount  ?? (body as any)?.prompt_token_count  ?? 0;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const outputTokens = (body as any)?.outputTextTokenCount ?? (body as any)?.generation_token_count ?? 0;
    if (inputTokens > 0 || outputTokens > 0) {
      return (inputTokens * pricing.input / 1000) + (outputTokens * pricing.output / 1000);
    }

    return 0;
  } catch {
    return 0;
  }
}

/** The built-in Bedrock pricing table — useful for displaying prices in UI. */
export { BEDROCK_PRICING };
