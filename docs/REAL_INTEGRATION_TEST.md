# PHASE 1: Real End-to-End Integration Test

First attempt at running the content-engine pipeline (research → extraction →
scenario → hook → voice → storage → Telegram adapter → orchestrator) against
real external services instead of test mocks.

**No secrets are committed or printed by this test.** It reads keys from
`process.env` (populated from `.env`/`.env.local`, which are gitignored) and
only ever prints their presence/absence, never their values. Nothing in this
document contains a real key.

## 1. Required environment variables

| Variable                                                                             | Service                  | Why needed                                                                                                                                   | Used in                                        | Required for first test                                                                           |
| ------------------------------------------------------------------------------------ | ------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------- | ------------------------------------------------------------------------------------------------- |
| `DATABASE_URL`                                                                       | PostgreSQL               | All pipeline stages read/write Topic/Source/Claim/Script/Hook/Video/Publication rows via Prisma                                              | `src/lib/db.ts` (every stage)                  | **Yes** — nothing runs without it                                                                 |
| `ANTHROPIC_API_KEY`                                                                  | Anthropic (Claude)       | LLM calls for claim extraction, script generation, hook generation — `LLM_PROVIDER` defaults to `"claude"`                                   | `src/lib/content-engine/llm/*`                 | **Yes**, unless `LLM_PROVIDER=openai`                                                             |
| `LLM_PROVIDER`                                                                       | — (config, not a secret) | Selects `"claude"` (default) or `"openai"` as the LLM backend                                                                                | `src/lib/content-engine/llm/*`                 | No — has a working default                                                                        |
| `OPENAI_API_KEY`                                                                     | OpenAI                   | Alternate LLM backend when `LLM_PROVIDER=openai`                                                                                             | `src/lib/content-engine/llm/*`                 | No, unless `LLM_PROVIDER=openai` (schema still requires it non-empty regardless — see note below) |
| `ELEVENLABS_API_KEY`                                                                 | ElevenLabs               | Text-to-speech narration for the render stage                                                                                                | `src/lib/content-engine/tts/elevenlabs.ts`     | **Yes**, to reach the Voice stage                                                                 |
| `SUPABASE_SERVICE_ROLE_KEY`                                                          | Supabase Storage         | Uploads rendered audio to the `content-engine-renders` bucket                                                                                | `src/lib/content-engine/storage/*`             | **Yes**, to reach the Storage stage                                                               |
| `NEXT_PUBLIC_SUPABASE_URL`                                                           | Supabase                 | Project URL for the Supabase client                                                                                                          | `src/lib/supabase/*`, storage                  | **Yes**, to reach the Storage stage                                                               |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY`                                                      | Supabase                 | Public client key (auth/dashboard, not content-engine specific)                                                                              | `src/lib/supabase/*`                           | No, for this test                                                                                 |
| `STRIPE_SECRET_KEY` / `STRIPE_WEBHOOK_SECRET` / `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY` | Stripe                   | Billing — unrelated to the content-engine pipeline                                                                                           | SaaS platform code                             | No                                                                                                |
| `NEXT_PUBLIC_APP_URL`                                                                | — (config)               | App base URL, has a `localhost:3000` default                                                                                                 | app-wide                                       | No                                                                                                |
| — (no env var)                                                                       | Telegram Bot API         | Telegram bot token is **not** an env var — it lives in `PlatformAccount.credentials` (a DB column), read by `readBotToken()` in `publish.ts` | `src/lib/content-engine/publishing/publish.ts` | **Yes** (as a DB row, once `DATABASE_URL` is real)                                                |

Note: `src/env.mjs`'s zod schema currently marks `OPENAI_API_KEY` as
required (non-empty) unconditionally, even though the code only calls it when
`LLM_PROVIDER=openai`. This is pre-existing scaffolding, not something this
test changed — flagging it here since it affects which vars must be set for
`env.mjs` validation to pass at all (validation was bypassed in this test run
via `SKIP_ENV_VALIDATION=1`, same as every other check this session).

## 2. `.env.example` review

Checked against `src/env.mjs`'s full zod schema: **`.env.example` (repo root)
is already complete.** Every required and optional var the schema declares is
present with a placeholder value. No update was made — there was nothing to
add. (The only var _not_ listed, `NODE_ENV`, has a working default and isn't
typically documented in examples.)

## 3. Critical finding: sandbox network egress policy

Before any test ran, real `fetch()` calls from this sandbox (Node.js, the
app's actual runtime) showed that **only `api.anthropic.com` is reachable**
through this environment's outbound proxy — regardless of which API keys are
supplied:

| Host                         | Result                                                                       |
| ---------------------------- | ---------------------------------------------------------------------------- |
| `api.anthropic.com`          | HTTP 401 (reached the real API — only auth failed, since no key is set here) |
| `api.openai.com`             | HTTP 403 — blocked by the proxy ("Host not in allowlist")                    |
| `api.elevenlabs.io`          | HTTP 403 — blocked by the proxy                                              |
| `api.telegram.org`           | HTTP 403 — blocked by the proxy                                              |
| `www.ebi.ac.uk` (Europe PMC) | HTTP 403 — blocked by the proxy                                              |

**This means even a fully-supplied `ELEVENLABS_API_KEY` / Telegram bot token /
`OPENAI_API_KEY` cannot be exercised for real from inside this Claude Code
session** — those hosts are blocked at the network layer, independent of
credentials. Only Anthropic calls (script/hook generation, claim extraction
when `LLM_PROVIDER=claude`) could ever be "real" from here, and only once
`ANTHROPIC_API_KEY` is supplied. Europe PMC research, ElevenLabs narration,
and Telegram publishing can only be verified for real outside this sandbox
(e.g. in Vercel/CI/local dev with unrestricted egress).

**Update, same day, with a real Supabase project:** the block is not limited
to HTTPS APIs — raw TCP is blocked too. With a real Supabase `DATABASE_URL`
supplied (both the pooled port 6543 and the direct port 5432 to
`*.pooler.supabase.com` were tried), `npx prisma db push` failed with `P1001:
Can't reach database server`, and a bare TCP connect attempt
(`/dev/tcp/<host>/5432` and `/dev/tcp/<host>/6543`) timed out identically on
both ports — before any authentication was even attempted. **This sandbox
cannot reach an external Postgres database at all, regardless of credentials
or which Postgres provider is used.** Combined with the HTTPS findings above,
this session's only usable network path is HTTPS to `api.anthropic.com`.

## 4. Test run result

Ran a minimal script that checks env vars, then attempts a real
`prisma.$connect()`, then (if that succeeds) would proceed through every
stage with real calls where reachable.

```
=== ENV VAR PRESENCE ===
DATABASE_URL: MISSING
ANTHROPIC_API_KEY: MISSING
OPENAI_API_KEY: MISSING
ELEVENLABS_API_KEY: MISSING

=== STAGE 1: DATABASE CONNECTIVITY (real Postgres) ===
STOP: DATABASE_URL is not set in this environment.
No .env/.env.local file exists in this sandbox and none was provided.
Needed: a real DATABASE_URL pointing at a reachable Postgres instance, supplied via .env.local.
```

**Per Andrey's instruction, this is reported as-is — no result was
simulated.** The run stopped at the first missing dependency and did not
proceed to research/extraction/scenario/hook/voice/storage/Telegram, since
doing so would have required either fabricating a database or faking success.

### A. REAL VERIFIED

_(none — no external service was successfully exercised this run)_

### B. MOCK VERIFIED

_(none — this test intentionally does not use mocks; see the existing `_.test.ts`suites, e.g.`publish.test.ts`, `elevenlabs.test.ts`, for mock-based coverage of the same code paths)\*

### C. NOT VERIFIED

| Stage                               | Real/Mock                                                | Input                        | Output                    | Status           | Error                                                                                                                                                                                                                         | Next action                                                                                                                                  |
| ----------------------------------- | -------------------------------------------------------- | ---------------------------- | ------------------------- | ---------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| Database connectivity               | Real (attempted, with a real Supabase `DATABASE_URL`)    | `DATABASE_URL` from env      | —                         | **Not verified** | `P1001: Can't reach database server` — this sandbox cannot open a raw TCP connection to an external Postgres at all (confirmed on both port 5432 and 6543, before authentication), independent of the credentials supplied    | Run this stage outside this sandbox (local dev, CI, Vercel) — no key or Postgres provider change fixes this                                  |
| Research (Europe PMC)               | Real (attempted)                                         | Topic title                  | Source rows               | **Not verified** | Blocked by both missing `DATABASE_URL` and network egress policy (host not in allowlist)                                                                                                                                      | Needs `DATABASE_URL` **and** a network path to `www.ebi.ac.uk` — not available in this sandbox regardless of keys                            |
| Claim extraction                    | Real (attempted)                                         | Source rows                  | Claim rows                | **Not verified** | Blocked by missing `DATABASE_URL`; would also need `ANTHROPIC_API_KEY`                                                                                                                                                        | Supply `DATABASE_URL` + `ANTHROPIC_API_KEY`                                                                                                  |
| Script generation                   | Real (attempted)                                         | Claim rows                   | Script + beats            | **Not verified** | Same as above                                                                                                                                                                                                                 | Same as above                                                                                                                                |
| Hook generation                     | Real (attempted)                                         | Script                       | Hook rows + scores        | **Not verified** | Same as above                                                                                                                                                                                                                 | Same as above                                                                                                                                |
| Voice (ElevenLabs narration)        | Real (attempted)                                         | Script text                  | Audio bytes               | **Not verified** | Blocked by both missing `DATABASE_URL` and network egress policy                                                                                                                                                              | Needs `DATABASE_URL`, `ELEVENLABS_API_KEY`, **and** network access to `api.elevenlabs.io` — not available in this sandbox regardless of keys |
| Storage (Supabase upload)           | Real (attempted)                                         | Audio bytes                  | Public URL                | **Not verified** | Blocked by missing `DATABASE_URL`/Supabase keys; not yet reached                                                                                                                                                              | Supply `DATABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `NEXT_PUBLIC_SUPABASE_URL`                                                               |
| Telegram adapter (dry-run)          | Real (attempted, `buildTelegramPublishPayload`, no send) | Video + PlatformAccount rows | Payload preview (no send) | **Not verified** | Blocked by missing `DATABASE_URL`; separately, `api.telegram.org` is network-blocked even once a bot token exists — irrelevant for the dry-run path itself (it never calls Telegram), but relevant for a later real-send test | Supply `DATABASE_URL` + a `PlatformAccount` row with a Telegram bot token in `credentials`                                                   |
| Orchestrator (`runContentPipeline`) | Real (attempted)                                         | Topic id                     | Pipeline result           | **Not verified** | Never reached — stopped at Stage 1                                                                                                                                                                                            | Same as Database connectivity, above                                                                                                         |

## 5. What's needed to get past Stage 1

**A real Supabase project and its `DATABASE_URL`/keys were supplied and
tried in this sandbox — that ruled out "missing credentials" as the
blocker.** What remains is purely environmental: this Claude Code cloud
session cannot open any outbound connection except HTTPS to
`api.anthropic.com`, so it cannot reach Postgres (any provider), Europe PMC,
ElevenLabs, Telegram, or OpenAI, regardless of what credentials it holds.

The only way to actually run this test for real is **outside this sandbox**:

1. Locally (e.g. Andrey's own machine, `git clone` + `npm install` + the same
   `.env.local` values), or
2. CI / a Vercel preview deployment, where egress isn't restricted this way.

`ANTHROPIC_API_KEY` is still unset even for the one stage this sandbox could
theoretically reach (Anthropic itself) — but since the database is
unreachable first, no stage can run here regardless.

Per instruction, stopping here after this first (unsuccessful — this
environment cannot run it) dry-run attempt, pending Andrey's direction on
whether to continue from a different environment.
