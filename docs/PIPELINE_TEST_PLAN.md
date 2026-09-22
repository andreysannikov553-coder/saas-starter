# Content Pipeline — Test Plan

Обновлено после pre-production audit стека PR #1→#9 (ветка `feat/pipeline-orchestrator`,
финальный коммит `85fd777`, 52 автотеста). Предыдущая версия этого документа (PR #10)
была написана до тестов и до фиксов идемпотентности в PR #6/#9 — этот файл её полностью
заменяет.

Три категории вместо прежних A–E: что реально исполнялось в этой песочнице (A), что
проверено только через мок внешней зависимости (B), и что не проверялось вообще, потому
что нужен живой сервис (C).

## A. VERIFIED LOCALLY

Исполнялось по-настоящему в этой песочнице, без моков внешних API/БД:

- **Prisma-схема** — `npx prisma generate` / `npx prisma validate` / `npx prisma format`
  проходят на актуальной схеме (`prisma/schema.prisma`, 459 строк).
- **Статическая корректность** — `tsc --noEmit`, `eslint .`, `prettier --check` чисты на
  каждом PR #1–#9 (единственное известное исключение — предсуществующая на `main`
  ошибка типов в `src/lib/stripe/webhook.ts:21`, не связана с этим пайплайном).
- **Сборка** — `npm run build` (с `SKIP_ENV_VALIDATION=1` и фиктивным `DATABASE_URL`)
  проходит.
- **Чистые функции** — валидаторы/парсеры LLM-ответов (`parseExtractedClaims`,
  `parseGeneratedScript`, `parseGeneratedHooks`), `classifySourceType`,
  `buildNarrationText`, `buildCaption` — исполнялись напрямую под `node:test`, без
  моков, потому что не трогают сеть/БД.

## B. VERIFIED WITH MOCKS

Логика оркестрации и интеграции проверена через `mock.module` (Node's
`--experimental-test-module-mocks`) — доказывает, что код _вызывает зависимости
правильно и в правильном порядке_, а не что сама зависимость (Postgres, Claude API,
ElevenLabs, Supabase, Telegram Bot API) действительно отвечает так, как замокано.

| Модуль                         | Тестов           | Что замокано                     | Доказывает                                                                                                             |
| ------------------------------ | ---------------- | -------------------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| `scripts/generate.test.ts`     | 3                | `@/lib/db`, LLM-провайдер        | script/beats создаются из валидного LLM-ответа                                                                         |
| `hooks/generate.test.ts`       | 3                | `@/lib/db`, LLM-провайдер        | hooks создаются, `belowThreshold` считается верно                                                                      |
| `publishing/telegram.test.ts`  | 4                | глобальный `fetch`               | Bot API запрос собирается правильно                                                                                    |
| `publishing/publish.test.ts`   | 6                | `@/lib/db`, `./telegram`         | `upsert()`-регрессия (PR #6): повторный вызов для того же `videoId`+`platformAccountId` не падает на unique-constraint |
| `tts/narrate.test.ts`          | 3 интеграционных | `@/lib/db`, ElevenLabs-клиент    | текст нарратора строится из beats, аудио-буфер прокидывается                                                           |
| `storage/index.test.ts`        | 2                | `@supabase/supabase-js`          | upload вызывается с `upsert:true`, публичный URL строится верно                                                        |
| `render/narrate-video.test.ts` | 3                | `@/lib/db`, `../storage`         | reuse существующей `QUEUED` строки Video при повторном запуске                                                         |
| `pipeline.test.ts`             | 7                | `@/lib/db` + все 6 stage-модулей | последовательность стадий, точки остановки, claims-дедуп фикс (PR #9)                                                  |

**Важное ограничение, обнаруженное этим аудитом:** мок доказывает только то, что
подставлено в него руками, и молчит о том, чего в моке нет:

- `publish.test.ts` доказывает, что **строка** `Publication` не дублируется в БД при
  повторном вызове. Он **не** доказывает, что повторный вызов не отправит сообщение в
  Telegram повторно — `publishVideoToTelegram` (`src/lib/content-engine/publishing/publish.ts:59-68`)
  безусловно делает `upsert(...update: {status: "PENDING"})` и затем безусловно
  вызывает `sendTelegramMessage`/`sendTelegramVideo`, даже если `publication.status`
  уже был `PUBLISHED`. Guard'а "уже опубликовано — пропустить" нет ни в коде, ни в тесте.
- `scripts/generate.test.ts` и `hooks/generate.test.ts` доказывают, что _одиночный_
  вызов создаёт корректные `Script`/`Hook` строки. Они не проверяют повторный вызов,
  потому что сам код (`generateScriptForTopic`, `generateHooksForScript`) не содержит
  проверки на уже существующий скрипт/хуки — оба безусловно вызывают `.create()`.
  Это симметрично багу, найденному и исправленному в PR #9 для claims, но здесь не
  исправлено (см. `PRODUCTION_READINESS.md` §7).
- `pipeline.test.ts` мокает все 6 stage-модулей одновременно, поэтому доказывает
  правильность **склейки**, а не правильность ни одной из стадий по отдельности —
  дублирующее это с точки B выше, а не с точкой A.

## C. REQUIRES REAL EXTERNAL SERVICE

Ничего в этом разделе не было вызвано ни разу — ни с реальными, ни с поддельными
данными, потому что зависимость либо недоступна из песочницы (нет сети/ключей), либо
требует ручной настройки внешнего сервиса.

| #   | Сервис                     | Env-переменная                                                                                           | Где используется в коде                                                                                              | Как проверить реально                                                                                                                                                                                                                                                                           | Ожидаемый результат                                                                                                                                    |
| --- | -------------------------- | -------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 1   | Postgres                   | `DATABASE_URL`                                                                                           | `src/lib/db/index.ts` (Prisma client), используется каждым модулем content-engine                                    | `npx prisma db push` на реальную БД, затем создать `Organization`+`Topic` вручную (нет UI/seed)                                                                                                                                                                                                 | Таблицы созданы, `Topic` строка читается обратно                                                                                                       |
| 2   | Europe PMC API             | — (публичный API, ключ не нужен)                                                                         | `src/lib/content-engine/research/index.ts` (`researchTopic`)                                                         | `DATABASE_URL=... npx tsx -e 'import{researchTopic}from"./src/lib/content-engine/research";researchTopic("<topicId>").then(console.log)'`                                                                                                                                                       | `{found, created, skipped}`, новые строки `Source`                                                                                                     |
| 3   | Anthropic (Claude)         | `ANTHROPIC_API_KEY` (нужен, если `LLM_PROVIDER=claude`, значение по умолчанию)                           | `src/lib/content-engine/llm/claude.ts`, используется `claims/extract.ts`, `scripts/generate.ts`, `hooks/generate.ts` | `DATABASE_URL=... ANTHROPIC_API_KEY=... npx tsx -e 'import{extractClaimsForSource}from"./src/lib/content-engine/claims/extract";extractClaimsForSource("<sourceId>").then(console.log)'`                                                                                                        | `{sourceId, extracted, saved}`, новые строки `Claim`                                                                                                   |
| 4   | OpenAI                     | `OPENAI_API_KEY` (альтернатива п.3, если `LLM_PROVIDER=openai`)                                          | `src/lib/content-engine/llm/openai.ts`                                                                               | Тот же вызов, что п.3, но с `LLM_PROVIDER=openai OPENAI_API_KEY=...`                                                                                                                                                                                                                            | То же                                                                                                                                                  |
| 5   | ElevenLabs                 | `ELEVENLABS_API_KEY`                                                                                     | `src/lib/content-engine/tts/elevenlabs.ts`, используется `tts/narrate.ts`                                            | `DATABASE_URL=... ELEVENLABS_API_KEY=... npx tsx -e 'import{narrateScript}from"./src/lib/content-engine/tts";narrateScript("<scriptId>",{voiceId:"<id>"}).then(r=>console.log(r.text,r.audio.length))'`                                                                                         | В памяти `Buffer` с mp3, `voiceId` нужно предварительно взять из ElevenLabs Voice Library                                                              |
| 6   | Supabase Storage           | `SUPABASE_SERVICE_ROLE_KEY`, `NEXT_PUBLIC_SUPABASE_URL`                                                  | `src/lib/content-engine/storage/index.ts` (`uploadRenderAsset`)                                                      | `DATABASE_URL=... ELEVENLABS_API_KEY=... SUPABASE_SERVICE_ROLE_KEY=... npx tsx -e 'import{renderNarrationForScript}from"./src/lib/content-engine/render/narrate-video";renderNarrationForScript("<scriptId>",{voiceId:"<id>"}).then(console.log)'`                                              | `{videoId, audioUrl}`, `Video.audioUrl` заполнен. **Бакет `content-engine-renders` нужно создать в Supabase заранее — кода для его автосоздания нет.** |
| 7   | Telegram Bot API           | нет env-переменной — токен лежит в `PlatformAccount.credentials.botToken` (JSON-колонка в БД, не `.env`) | `src/lib/content-engine/publishing/telegram.ts`, `publishing/publish.ts`                                             | **НЕ выполнять автоматически.** Ручной шаг под контролем Андрея: создать бота через @BotFather, добавить `PlatformAccount` строку (`platform: TELEGRAM`, `handle: "<chat_id>"`, `credentials: {"botToken": "..."}`), затем вызвать `publishVideoToTelegram("<videoId>", "<platformAccountId>")` | `{publicationId, externalId, mode}`, реальное сообщение в Telegram-чате                                                                                |
| 8   | Полный pipeline end-to-end | все ключи выше                                                                                           | `src/lib/content-engine/pipeline.ts` (`runContentPipeline`)                                                          | Только после п.1–7 по отдельности: `runContentPipeline("<topicId>", {publish: {ttsVoiceId: "<id>", telegramPlatformAccountId: "<id>"}})`                                                                                                                                                        | `RunContentPipelineResult` с `stoppedAt: null`, `publicationId` заполнен                                                                               |

Пункт 7 (Telegram) в этой сессии **не выполнялся и не будет выполняться** — это прямое
ограничение задания ("не публикуй ничего в Telegram").

---

См. также `PRODUCTION_READINESS.md` для системной оценки (идемпотентность, retry,
логирование, безопасность) поверх этой таблицы.
