/**
 * Models a caller may request.
 *
 * The model name arrives from user input, so this is an allow-list, not a
 * default: an unrestricted string lets a free-tier user pick the most
 * expensive model in the catalogue.
 */
export const ALLOWED_MODELS = ["gpt-4o-mini", "gpt-4o"] as const;

export type AllowedModel = (typeof ALLOWED_MODELS)[number];

/** Cheap tier by default — these calls are high-volume. */
export const DEFAULT_MODEL: AllowedModel = "gpt-4o-mini";

export function isAllowedModel(model: string): model is AllowedModel {
  return (ALLOWED_MODELS as readonly string[]).includes(model);
}
