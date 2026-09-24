import { createEnv } from "@t3-oss/env-nextjs";
import { z } from "zod";

export const env = createEnv({
  server: {
    // Database
    DATABASE_URL: z.string().url(),

    // OpenAI
    OPENAI_API_KEY: z.string().min(1),
    // Optional: point the OpenAI-shaped client at another OpenAI-compatible
    // endpoint (e.g. Groq's free API) instead of api.openai.com.
    OPENAI_BASE_URL: z.string().url().optional(),
    OPENAI_MODEL: z.string().min(1).optional(),

    // Anthropic (content engine — optional: required only when
    // LLM_PROVIDER is "claude", the default)
    ANTHROPIC_API_KEY: z.string().min(1).optional(),
    // Required only for an org-level (non-workspace-scoped) Anthropic API key
    // that Anthropic rejects without an anthropic-workspace-id header.
    ANTHROPIC_WORKSPACE_ID: z.string().min(1).optional(),

    // More free OpenAI-compatible providers for the "fallback" chain (see
    // src/lib/content-engine/llm/index.ts) — each optional, only used if set.
    CEREBRAS_API_KEY: z.string().min(1).optional(),
    CEREBRAS_MODEL: z.string().min(1).optional(),
    GEMINI_API_KEY: z.string().min(1).optional(),
    GEMINI_MODEL: z.string().min(1).optional(),
    OPENROUTER_API_KEY: z.string().min(1).optional(),
    OPENROUTER_MODEL: z.string().min(1).optional(),
    MISTRAL_API_KEY: z.string().min(1).optional(),
    MISTRAL_MODEL: z.string().min(1).optional(),
    // GitHub Models — free with any GitHub account, a PAT with "Models: read"
    // permission (github.com/settings/personal-access-tokens), not a signup.
    GITHUB_MODELS_TOKEN: z.string().min(1).optional(),
    GITHUB_MODELS_MODEL: z.string().min(1).optional(),
    // Cloudflare Workers AI — needs both, unlike the single-key providers above.
    CLOUDFLARE_ACCOUNT_ID: z.string().min(1).optional(),
    CLOUDFLARE_API_TOKEN: z.string().min(1).optional(),
    CLOUDFLARE_MODEL: z.string().min(1).optional(),

    // "fallback" (default) chains every configured free provider above, then
    // Claude — see getLLMProvider. "claude"/"openai" pin a single provider.
    LLM_PROVIDER: z.enum(["claude", "openai", "fallback"]).default("fallback"),

    // ElevenLabs (content engine narration — optional: only needed once a
    // PlatformAccount/Character actually calls the TTS stage)
    ELEVENLABS_API_KEY: z.string().min(1).optional(),

    // Content engine autoposting (/api/cron/publish, triggered by Vercel Cron)
    // CRON_SECRET must match the request's Authorization: Bearer header —
    // Vercel sends this automatically for cron-invoked requests once this
    // env var is set on the project.
    CRON_SECRET: z.string().min(1).optional(),
    TELEGRAM_PLATFORM_ACCOUNT_ID: z.string().min(1).optional(),

    // Stripe
    STRIPE_SECRET_KEY: z.string().min(1),
    STRIPE_WEBHOOK_SECRET: z.string().min(1),

    // Supabase
    SUPABASE_SERVICE_ROLE_KEY: z.string().min(1),

    // Environment
    NODE_ENV: z.enum(["development", "production", "test"]).default("development"),
  },
  client: {
    // Supabase
    NEXT_PUBLIC_SUPABASE_URL: z.string().url(),
    NEXT_PUBLIC_SUPABASE_ANON_KEY: z.string().min(1),

    // Stripe
    NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY: z.string().min(1),

    // App
    NEXT_PUBLIC_APP_URL: z.string().url().default("http://localhost:3000"),
  },
  runtimeEnv: {
    // Server
    DATABASE_URL: process.env.DATABASE_URL,
    OPENAI_API_KEY: process.env.OPENAI_API_KEY,
    OPENAI_BASE_URL: process.env.OPENAI_BASE_URL,
    OPENAI_MODEL: process.env.OPENAI_MODEL,
    ANTHROPIC_API_KEY: process.env.ANTHROPIC_API_KEY,
    ANTHROPIC_WORKSPACE_ID: process.env.ANTHROPIC_WORKSPACE_ID,
    CEREBRAS_API_KEY: process.env.CEREBRAS_API_KEY,
    CEREBRAS_MODEL: process.env.CEREBRAS_MODEL,
    GEMINI_API_KEY: process.env.GEMINI_API_KEY,
    GEMINI_MODEL: process.env.GEMINI_MODEL,
    OPENROUTER_API_KEY: process.env.OPENROUTER_API_KEY,
    OPENROUTER_MODEL: process.env.OPENROUTER_MODEL,
    MISTRAL_API_KEY: process.env.MISTRAL_API_KEY,
    MISTRAL_MODEL: process.env.MISTRAL_MODEL,
    GITHUB_MODELS_TOKEN: process.env.GITHUB_MODELS_TOKEN,
    GITHUB_MODELS_MODEL: process.env.GITHUB_MODELS_MODEL,
    CLOUDFLARE_ACCOUNT_ID: process.env.CLOUDFLARE_ACCOUNT_ID,
    CLOUDFLARE_API_TOKEN: process.env.CLOUDFLARE_API_TOKEN,
    CLOUDFLARE_MODEL: process.env.CLOUDFLARE_MODEL,
    LLM_PROVIDER: process.env.LLM_PROVIDER,
    ELEVENLABS_API_KEY: process.env.ELEVENLABS_API_KEY,
    CRON_SECRET: process.env.CRON_SECRET,
    TELEGRAM_PLATFORM_ACCOUNT_ID: process.env.TELEGRAM_PLATFORM_ACCOUNT_ID,
    STRIPE_SECRET_KEY: process.env.STRIPE_SECRET_KEY,
    STRIPE_WEBHOOK_SECRET: process.env.STRIPE_WEBHOOK_SECRET,
    SUPABASE_SERVICE_ROLE_KEY: process.env.SUPABASE_SERVICE_ROLE_KEY,
    NODE_ENV: process.env.NODE_ENV,

    // Client
    NEXT_PUBLIC_SUPABASE_URL: process.env.NEXT_PUBLIC_SUPABASE_URL,
    NEXT_PUBLIC_SUPABASE_ANON_KEY: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
    NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY: process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY,
    NEXT_PUBLIC_APP_URL: process.env.NEXT_PUBLIC_APP_URL,
  },
  skipValidation: !!process.env.SKIP_ENV_VALIDATION,
  emptyStringAsUndefined: true,
});
