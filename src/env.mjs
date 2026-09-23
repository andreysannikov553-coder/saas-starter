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
    LLM_PROVIDER: z.enum(["claude", "openai"]).default("claude"),

    // ElevenLabs (content engine narration — optional: only needed once a
    // PlatformAccount/Character actually calls the TTS stage)
    ELEVENLABS_API_KEY: z.string().min(1).optional(),

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
    LLM_PROVIDER: process.env.LLM_PROVIDER,
    ELEVENLABS_API_KEY: process.env.ELEVENLABS_API_KEY,
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
