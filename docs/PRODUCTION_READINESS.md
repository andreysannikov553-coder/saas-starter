# Content Pipeline — Production Readiness

Pre-production audit стека PR #1→#9 (`feat/pipeline-orchestrator`, коммит `85fd777`,
52 теста) как единой системы, а не отдельных PR. Смотрит на data flow
RESEARCH → EXTRACTION → SCENARIO → HOOK → VOICE → STORAGE → TELEGRAM → ORCHESTRATION.
Не включает video assembly/ffmpeg/Trend Scanner/Idea Generator — это следующие,
отдельно спланированные этапы.

## 1. Architecture

Восемь модулей `src/lib/content-engine/{research,claims,scripts,hooks,tts,storage+render,publishing,pipeline.ts}`,
каждый — чистая библиотечная функция без побочного состояния вне Prisma/внешнего API.
Нет очереди задач, нет воркеров, нет cron — `runContentPipeline(topicId, options)` это
синхронная (в рамках одного вызова) цепочка `await`, вызываемая напрямую из кода.
Стадии строго последовательны и совпадают со схемой из дискавери-дока:

```
RESEARCH (research/)  → EXTRACTION (claims/)  → SCENARIO (scripts/)
  → HOOK (hooks/)      → VOICE (tts/ + render/narrate-video.ts)
  → STORAGE (storage/) → TELEGRAM (publishing/) → ORCHESTRATION (pipeline.ts)
```

`pipeline.ts` останавливается (`stoppedAt`), а не бросает исключение, на каждом
ожидаемом "пустом" результате (нет источников, нет claims, хук ниже порога, нет
`options.publish`) — исключение означает реальный сбой, а не нормальный конец
воронки для конкретной темы.

**Не построено вообще:** video assembly/Render Gate (нужен ffmpeg — не установлен в
песочнице), Trend Scanner, Idea Generator (создание строк `Topic` — начало воронки).
Явно исключены из этого аудита по заданию.

## 2. Database

Prisma/Postgres, схема в `prisma/schema.prisma` (459 строк). Content-engine
модели: `Organization`, `Character`, `PlatformAccount`, `Topic`, `Source`, `Claim`,
`Script`, `ScriptBeat`, `Hook`, `Video`, `Publication`, `AnalyticsSnapshot`,
`Experiment`. Ключевые ограничения целостности, использованные пайплайном:
`@@unique([orgId, slug])` (Character), `@@unique([orgId, platform, handle])`
(PlatformAccount), `@@unique([scriptId, order])` (ScriptBeat),
`@@unique([videoId, platformAccountId])` (Publication — это то, на чём построен
upsert-фикс PR #6). Каскады настроены по смыслу: `Source.topicId` — `onDelete:
Cascade`, а связи, которые не должны утаскивать за собой дочерние записи при
удалении родителя (`Script.topicId`/`characterId`, `ScriptBeat.claimId`) —
`onDelete: SetNull`.

**В БД сейчас нет ни одной строки** ни в одной из этих таблиц — `prisma/seed.ts`
остаётся пустым шаблоном (только `console.log`, без реальных данных). Пайплайн
физически не с чего запустить без ручного создания `Organization`+`Topic` (и для
последней стадии — `PlatformAccount`).

## 3. AI

Единый `LLMProvider`-интерфейс (`src/lib/content-engine/llm/{types,claude,openai,index}.ts`)
с двумя реализациями, выбор через `LLM_PROVIDER` (по умолчанию `claude`,
`ANTHROPIC_API_KEY`; альтернатива `openai`, `OPENAI_API_KEY`). Используется тремя
стадиями: claim extraction, script generation, hook generation — каждая со своим
парсером/валидатором LLM-ответа (`parseExtractedClaims`, `parseGeneratedScript`,
`parseGeneratedHooks`), покрытым юнит-тестами на чистой логике (23 теста суммарно).
**Ни один живой вызов Claude/OpenAI не выполнялся** — нет ключей в песочнице.
Валидаторы защищают от структурно некорректного ответа модели (несуществующий
`claimId`, оценка вне диапазона), но не доказывают, что сам вызов API работает.

## 4. External APIs

Полный список см. в `PIPELINE_TEST_PLAN.md`, категория C. Кратко: Europe PMC
(публичный, без ключа, заблокирован сетевым прокси песочницы — не проверялся ни
разу), Anthropic/OpenAI (нет ключей), ElevenLabs (нет ключа), Supabase Storage
(нет service role ключа, и бакет `content-engine-renders` никем не создан заранее —
код на него ссылается, но не создаёт), Telegram Bot API (см. §5).

## 5. Telegram

Токен бота **не в `.env`** — хранится в `PlatformAccount.credentials` (JSON-колонка
в БД), читается через `readBotToken()` в `publishing/publish.ts:107-111`. Это
осознанное решение: один бот на организацию/аккаунт, а не один глобальный ключ.
`publishVideoToTelegram` шлёт видео при наличии `Video.assetUrl`, иначе — текстовый
фолбэк (hook + CTA строки скрипта) — текстовый пост валиден и полезен ещё до того,
как появится video assembly.

**Критическая находка аудита:** `publication.upsert()` (PR #6-фикс) безусловно
переводит статус в `PENDING` и **безусловно** отправляет сообщение в Telegram —
даже если `Publication.status` уже был `PUBLISHED` (`publishing/publish.ts:59-68`).
Guard'а вида "уже опубликовано — не отправлять повторно" нет. Тест
`publish.test.ts` доказывает только, что повторный вызов не роняет запрос на
unique-constraint в БД (это и был баг PR #6) — он не проверяет и не предотвращает
повторную реальную отправку в Telegram. При включении retry-логики на уровне
оркестратора (её сейчас нет, см. §7) это станет реальным риском задвоенной публикации.
**В рамках этой сессии в Telegram ничего не отправлялось и не будет отправляться.**

## 6. Storage

Supabase Storage через `@supabase/supabase-js`, `storage/index.ts` (`uploadRenderAsset`,
`upload(..., {upsert: true})`). `render/narrate-video.ts` переиспользует существующую
`QUEUED`-строку `Video` для скрипта вместо создания новой при повторном запуске
(идемпотентно на уровне БД). **Не проверено ни разу вживую** — нет ключа, и, что
важнее, бакет `content-engine-renders` не создан в самом Supabase проекте, так что
первый реальный вызов гарантированно упадёт, пока кто-то не создаст бакет вручную.

## 7. Idempotency

Сводка по всем стадиям (повторный запуск пайплайна для той же темы):

| Стадия                             | Идемпотентна?               | Механизм                                                                                                                                                                  |
| ---------------------------------- | --------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Research                           | Да                          | дедуп источников по URL в рамках темы                                                                                                                                     |
| Extraction (claims)                | Да (на уровне оркестратора) | `pipeline.ts` фильтрует `source: {claims: {none: {}}}` — фикс PR #9. Сама `extractClaimsForSource` guard'а не имеет; при прямом вызове в обход `pipeline.ts` продублирует |
| **Script generation**              | **Нет**                     | `generateScriptForTopic` безусловно вызывает `prisma.script.create(...)` — повторный запуск для той же темы создаёт второй `Script`+`ScriptBeat` набор                    |
| **Hooks**                          | **Нет**                     | `generateHooksForScript` безусловно создаёт новые `Hook` строки — повторный запуск создаёт дубликаты                                                                      |
| Narration/Video                    | Да                          | переиспользует существующую `QUEUED`-строку `Video`                                                                                                                       |
| Publish (DB)                       | Да                          | `upsert()` на `@@unique([videoId, platformAccountId])`                                                                                                                    |
| **Publish (Telegram side-effect)** | **Нет**                     | см. §5 — нет guard'а на уже-`PUBLISHED` статус                                                                                                                            |

Два пункта без идемпотентности (script/hooks) — прямой симметричный аналог бага,
найденного и исправленного в PR #9 для claims, но здесь не исправлялся, так как это
выходило за рамки задачи PR #9. Стоит исправить тем же паттерном
(`findFirst`-проверка перед `create`) до первого продакшен-прогона, если пайплайн
может быть запущен для темы, для которой уже есть скрипт.

## 8. Error handling

Только `publishing/publish.ts` содержит `try/catch` — при ошибке отправки помечает
`Publication.status = "FAILED"` и перебрасывает исключение дальше. Все остальные
стадии (`research`, `claims`, `scripts`, `hooks`, `tts`, `storage`) не перехватывают
ошибки вообще — исключение из Prisma/внешнего API/парсера всплывает наружу
непойманным, останавливая `runContentPipeline` целиком без частичного отката и без
сохранения состояния "на чём упало", кроме того, что уже успело записаться в БД до
точки сбоя. **Retry нигде не реализован** — ни на уровне HTTP-клиентов, ни на уровне
оркестратора; единственное упоминание слова "retry" в кодовой базе — комментарий
в `publish.ts`, поясняющий, зачем нужен upsert, а не сама retry-логика.

## 9. Security

- `orgId` во всех записях content-engine выводится из доверенной родительской записи
  (`topic.orgId`, `script.orgId`, `video.orgId`), никогда не приходит напрямую от
  вызывающего кода — изоляция организаций корректна на уровне записи данных.
- Content-engine **нигде не подключён** ни к одному Next.js API route, server action
  или UI-компоненту (`grep` по `src/app/` на `content-engine`/`runContentPipeline`/
  названия функций стадий — ноль совпадений). Это значит, что вопрос
  авторизации/аутентификации на входе пока не стоит физически — пайплайн вызывается
  только напрямую из кода (скрипт/будущий admin-инструмент), не из HTTP-запроса.
  Как только появится вызывающий эндпоинт, потребуется отдельная проверка, что
  вызывающий пользователь имеет права на `orgId` темы — сейчас такой проверки
  негде быть, потому что негде вызывать.
- Telegram bot token хранится в БД (`PlatformAccount.credentials`, JSON), не в
  `.env` — соответствует принципу "один токен на аккаунт", но означает, что доступ
  к строке БД равен доступу к токену; в схеме нет отдельного шифрования этого поля.

## 10. Observability

**Логирования нет вообще.** `grep -rn "console\.\|logger\." src/lib/content-engine/`
даёт одно совпадение — это docstring-комментарий в `llm/types.ts` ("Short id for
logging..."), не код. Единственные реальные `console.log`/`console.error` во всём
репозитории, касающиеся этой темы, — в `prisma/seed.ts` (пустой boilerplate,
не относится к пайплайну). Ни одна стадия не пишет структурированный лог об успехе/
неудаче/длительности вызова — единственный источник состояния после прогона это
содержимое БД (или брошенное исключение).

## 11. Deployment

Нет отдельного деплой-артефакта для пайплайна — это часть основного Next.js
приложения (`saas-starter`), деплоится вместе с ним. Нет очереди/крона/воркера —
`runContentPipeline` нужно вызывать откуда-то (сейчас неоткуда, см. §9). Для
реального прогона после подключения сервисов (`PIPELINE_TEST_PLAN.md`, категория C)
дополнительно нужен `ffmpeg`/`ffprobe` в окружении — не для этого этапа (video
assembly не реализован), но для последующего.

## 12. Known limitations

- Script/Hook generation не идемпотентны при повторном запуске (§7) — риск дублей
  в БД, не риск внешнего побочного эффекта.
- Publish не идемпотентен на стороне Telegram при повторном запуске
  уже-опубликованного видео (§5, §7) — риск дублирующего сообщения в реальном чате.
- Retry нигде не реализован (§8) — любой транзиентный сбой внешнего API
  останавливает весь прогон без повторной попытки.
- Логирования нет (§10) — после реального прогона не будет журнала того, что
  происходило, кроме итогового состояния БД.
- Content-engine не подключён ни к одному вызывающему эндпоинту (§9) — сейчас
  вызывается только напрямую из кода.
- Video assembly/ffmpeg, Trend Scanner, Idea Generator не реализованы — по плану,
  следующие отдельные этапы, вне рамок этого аудита.
- Supabase bucket для рендеров не создан заранее — первый реальный вызов
  `uploadRenderAsset` упадёт, пока кто-то не создаст бакет вручную.
- `src/lib/stripe/webhook.ts:21` — предсуществующая, не связанная с этим пайплайном
  ошибка типов на `main`, зафиксирована во всех PR-отчётах #1–#9 как заведомо вне
  зоны ответственности этой работы.
