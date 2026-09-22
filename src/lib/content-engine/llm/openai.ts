import OpenAI from "openai";
import type { LLMProvider, StructuredRequest } from "./types";

/**
 * OpenAI provider. Structured output uses Chat Completions' native
 * `response_format: json_schema` with `strict: true`, so the API itself
 * rejects a response that doesn't validate — we still run `request.parse`
 * on top for the same runtime guarantees the Claude provider gives (e.g. the
 * hedge-phrase rule in parseExtractedClaims), since `strict` only enforces
 * shape, not our domain rules.
 */
export class OpenAIProvider implements LLMProvider {
  readonly id = "openai";

  private readonly client: OpenAI;
  private readonly model: string;

  constructor(options: { apiKey: string; model?: string }) {
    this.client = new OpenAI({ apiKey: options.apiKey });
    // gpt-4o-mini: OpenAI's cheap-tier model, mirroring Haiku's role on the
    // Claude side for high-volume extraction work.
    this.model = options.model ?? "gpt-4o-mini";
  }

  async generateStructured<T>(request: StructuredRequest<T>): Promise<T> {
    const response = await this.client.chat.completions.create({
      model: this.model,
      max_tokens: request.maxTokens ?? 4096,
      messages: [
        { role: "system", content: request.system },
        { role: "user", content: request.prompt },
      ],
      response_format: {
        type: "json_schema",
        json_schema: {
          name: request.schemaName,
          schema: request.schema,
          strict: true,
        },
      },
    });

    const content = response.choices[0]?.message?.content;
    if (!content) {
      throw new Error(
        `OpenAI did not return content for ${request.schemaName} (finish_reason: ${response.choices[0]?.finish_reason})`
      );
    }

    return request.parse(JSON.parse(content));
  }
}
