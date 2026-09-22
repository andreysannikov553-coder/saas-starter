import Anthropic from "@anthropic-ai/sdk";
import type { LLMProvider, StructuredRequest } from "./types";

/**
 * Claude provider. Structured output is implemented as a single forced tool
 * call: the schema becomes the tool's input_schema, `tool_choice` forces that
 * exact tool, and the tool_use block's `input` arrives already parsed as JSON
 * by the SDK — no text-mode "return only JSON" prompting, and no free-form
 * text for the model to wrap the JSON in.
 */
export class ClaudeProvider implements LLMProvider {
  readonly id = "claude";

  private readonly client: Anthropic;
  private readonly model: string;

  constructor(options: { apiKey: string; model?: string }) {
    this.client = new Anthropic({ apiKey: options.apiKey });
    // Haiku 4.5: cheap enough for high-volume extraction work; see
    // README section 8 (tech stack) — a bigger model is a per-call override,
    // not a default, so cost per video stays predictable.
    this.model = options.model ?? "claude-haiku-4-5";
  }

  async generateStructured<T>(request: StructuredRequest<T>): Promise<T> {
    const response = await this.client.messages.create({
      model: this.model,
      max_tokens: request.maxTokens ?? 4096,
      system: request.system,
      messages: [{ role: "user", content: request.prompt }],
      tools: [
        {
          name: request.schemaName,
          description: `Return the result as ${request.schemaName}, matching the given schema exactly.`,
          input_schema: request.schema as Anthropic.Tool.InputSchema,
        },
      ],
      tool_choice: { type: "tool", name: request.schemaName },
    });

    const toolUse = response.content.find(
      (block): block is Anthropic.ToolUseBlock => block.type === "tool_use"
    );

    if (!toolUse) {
      throw new Error(
        `Claude did not return a ${request.schemaName} tool call (stop_reason: ${response.stop_reason})`
      );
    }

    return request.parse(toolUse.input);
  }
}
