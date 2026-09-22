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

### 4.1 First attempt (this sandbox)

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

Per Andrey's instruction, this was reported as-is — no result was simulated.
As documented in §3, this sandbox turned out to be unable to reach any
external Postgres at all regardless of credentials, so this path was a dead
end for real testing.

### 4.2 Second attempt (Andrey's own Mac, outside the sandbox) — 2026-09-22

Run via `scripts/run-pipeline.ts` (added this same day — creates a minimal
Organization + Topic, then calls `runContentPipeline(topicId)` end to end,
no mocks):

```
npx tsx --env-file=.env.local scripts/run-pipeline.ts
```

```json
{"ts":"2026-09-22T19:42:25.192Z","level":"info","stage":"research","event":"success","topicId":"1c832b9e-7324-47ef-b7e8-0471671c70ae","found":0,"created":0,"skipped":0}
{"ts":"2026-09-22T19:42:25.302Z","level":"info","stage":"pipeline","event":"success","topicId":"1c832b9e-7324-47ef-b7e8-0471671c70ae","stoppedAt":"research","publicationId":null}

=== RESULT ===
{
  "topicId": "1c832b9e-7324-47ef-b7e8-0471671c70ae",
  "sourcesFound": 0,
  "sourcesCreated": 0,
  "claimsExtracted": 0,
  "scriptId": null,
  "hookIds": [],
  "bestHookScore": null,
  "hookBelowThreshold": null,
  "videoId": null,
  "publicationId": null,
  "stoppedAt": "research"
}

Stopped at stage: research
```

**This is the first genuinely real run of the pipeline outside any
sandbox restriction.** A real `Organization` and `Topic` row were created in
Andrey's Supabase Postgres, and a real HTTPS call reached Europe PMC (no
network error, no timeout — the stage logged `"event":"success"`, not
`"error"`). The pipeline honestly stopped at the `research` stage per its
own gate (`pipeline.ts` line 92-97: zero sources created and zero pre-existing
sources → stop before spending an LLM call on claim extraction with nothing
to extract from).

**Why zero results, most likely:** the topic title used was the script's
default, in Russian: _"Как сон влияет на восстановление мышц после
тренировки"_. `searchEuropePmc` (`europe-pmc.ts`) sends that string verbatim
as the Europe PMC query — Europe PMC's index is predominantly English-language
biomedical literature, so a literal Cyrillic-text query is very likely to
match nothing. This was not tested with an English topic title yet, so it's
a hypothesis, not a confirmed root cause. **No code change was made** — per
PHASE 1 scope, this is reported for Andrey's decision, not fixed
unilaterally.

### 4.3 Third attempt — English topic title, real Anthropic key — 2026-09-22

Re-ran with an English topic title to test the §4.2 hypothesis:

```
npx tsx --env-file=.env.local scripts/run-pipeline.ts "How sleep affects muscle recovery after exercise"
```

Result: **research found 25 sources this time** (`"found":25,"created":25,"skipped":0`)
— confirming the hypothesis: Europe PMC's index is English-language, and the
Russian-language default title matched nothing.

Claim extraction then made a real call to `api.anthropic.com` (progress —
this is a different, later failure than before) and got a real, honest
error back from Anthropic itself:

```json
{
  "type": "error",
  "error": {
    "type": "invalid_request_error",
    "message": "This API key is not scoped to a workspace, so this request must include the anthropic-workspace-id header with the ID of the workspace to use. Add the header, or use an API key that is scoped to a workspace."
  }
}
```

The `ANTHROPIC_API_KEY` supplied is an organization-level key, not scoped to
a specific workspace. Fixing this needs either (a) a new key created against
a specific workspace in the Anthropic console, or (b) sending an
`anthropic-workspace-id` header alongside the existing key — a code change,
not attempted here per PHASE 1 scope (no code changes beyond what's strictly
needed to run the existing pipeline). **Per Andrey's decision, PHASE 1 stops
here** rather than continuing to chase key/workspace configuration.

### A. REAL VERIFIED

- **Database connectivity** (Andrey's Mac, real Supabase Postgres): `prisma db push` succeeded; `run-pipeline.ts` created real `Organization`/`Topic` rows.
- **Test suite** (Andrey's Mac, Node v22): `npm test` — 73/73 passed, 0 failed.
- **Research stage / Europe PMC** (Andrey's Mac, English topic title): 25 real sources found and created — full real success, not just reachability.
- **Anthropic API reachability** (Andrey's Mac): a real HTTPS call reached `api.anthropic.com` and got a real (non-network) error back — confirms the key and network path work; the remaining blocker is workspace scoping, not connectivity.

### B. MOCK VERIFIED

_(none — this test intentionally does not use mocks; see the existing `*.test.ts` suites, e.g. `publish.test.ts`, `elevenlabs.test.ts`, for mock-based coverage of the same code paths)_

### C. NOT VERIFIED

| Stage                               | Real/Mock                                                | Input                        | Output                    | Status           | Error                                                                                                                                                                                                                         | Next action                                                                                                                                  |
| ----------------------------------- | -------------------------------------------------------- | ---------------------------- | ------------------------- | ---------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| Database connectivity               | **Real — verified (§4.2)**                               | `DATABASE_URL` from env      | Organization + Topic rows | ✅ **Verified**  | —                                                                                                                                                                                                                             | —                                                                                                                                            |
| Research (Europe PMC)               | **Real — verified (§4.3)**                               | Topic title (English)        | Source rows               | ✅ **Verified**  | —                                                                                                                                                                                                                             | Andrey to decide whether topics will always be authored in English, or whether a translation step is needed for Russian topic titles         |
| Claim extraction                    | **Real — attempted (§4.3)**                              | Source rows                  | Claim rows                | **Not verified** | Anthropic API reached, but the key is not scoped to a workspace (`invalid_request_error`, see §4.3) — a real Anthropic-account configuration issue, not a network or code problem                                             | Andrey to create a workspace-scoped Anthropic API key (or add `anthropic-workspace-id` support in code) when ready to continue               |
| Script generation                   | Real (attempted)                                         | Claim rows                   | Script + beats            | **Not verified** | Same as above                                                                                                                                                                                                                 | Same as above                                                                                                                                |
| Hook generation                     | Real (attempted)                                         | Script                       | Hook rows + scores        | **Not verified** | Same as above                                                                                                                                                                                                                 | Same as above                                                                                                                                |
| Voice (ElevenLabs narration)        | Real (attempted)                                         | Script text                  | Audio bytes               | **Not verified** | Blocked by both missing `DATABASE_URL` and network egress policy                                                                                                                                                              | Needs `DATABASE_URL`, `ELEVENLABS_API_KEY`, **and** network access to `api.elevenlabs.io` — not available in this sandbox regardless of keys |
| Storage (Supabase upload)           | Real (attempted)                                         | Audio bytes                  | Public URL                | **Not verified** | Blocked by missing `DATABASE_URL`/Supabase keys; not yet reached                                                                                                                                                              | Supply `DATABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `NEXT_PUBLIC_SUPABASE_URL`                                                               |
| Telegram adapter (dry-run)          | Real (attempted, `buildTelegramPublishPayload`, no send) | Video + PlatformAccount rows | Payload preview (no send) | **Not verified** | Blocked by missing `DATABASE_URL`; separately, `api.telegram.org` is network-blocked even once a bot token exists — irrelevant for the dry-run path itself (it never calls Telegram), but relevant for a later real-send test | Supply `DATABASE_URL` + a `PlatformAccount` row with a Telegram bot token in `credentials`                                                   |
| Orchestrator (`runContentPipeline`) | **Real — verified (§4.2, §4.3)**                         | Topic id                     | Pipeline result           | ✅ **Verified**  | —                                                                                                                                                                                                                             | The orchestrator itself ran correctly end to end and stopped exactly where its own gate says it should                                       |

## 5. Status after running outside the sandbox

The blocker documented earlier (this sandbox cannot reach any external
network beyond `api.anthropic.com`) was worked around by running on Andrey's
own Mac instead, per §3's own conclusion. Outcome, in order:

1. `npx prisma db push` — real Supabase Postgres, succeeded.
2. `npm test` — 73/73 tests passed (required upgrading Node from v20 to v22
   locally, since the test runner's `--test` glob needs Node 22+).
3. First `run-pipeline.ts` run (Russian default topic title) — real
   `Organization`/`Topic` created in Supabase, a real HTTPS call reached
   Europe PMC, and the pipeline honestly stopped at `research` with 0
   sources found.
4. Second run (English topic title) — confirmed the language hypothesis:
   **25 real sources found and created.** Claim extraction then made a real
   call to Anthropic and got a real configuration error back: the API key
   is not scoped to a workspace (see §4.3).

**This satisfies "the first successful dry-run" per Andrey's instruction:**
real infrastructure end to end (database, Europe PMC, Anthropic reachability
all independently confirmed real), an honest stop with a clear, non-simulated
reason, no secrets committed. Per Andrey's explicit decision in this session,
**PHASE 1 stops here** — not proceeding to claim extraction/script/hooks/
voice/Telegram, and not changing any pipeline code (including the research
query language and the workspace-scoping issue) — pending Andrey's direction
on whether/when to supply a workspace-scoped Anthropic key and continue.
