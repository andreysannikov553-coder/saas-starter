# PROJECT AUDIT

Дата аудита: 21 сентября 2026
Ветка: `main` @ `97f5d13`
Метод: чтение всего исходного кода (4 188 строк, 71 файл) + фактический прогон `tsc`, `eslint`, `prettier`, `next build` и `next start` с реальными HTTP-запросами к собранному приложению.

На этом этапе код не изменялся.

---

## 0. Краткое резюме

Проект — это форк/шаблон SaaS-стартера (Next.js 16 + Supabase + Stripe + OpenAI). Архитектурный скелет выбран грамотно и ломать его не нужно. Но **в текущем виде проект не собирается и, даже если собрать, не работает как сайт**:

1. `npm run build` падает — две независимые ошибки (см. C-01, C-02).
2. После обхода этих ошибок собранное приложение отдаёт **307 redirect на `/login` вообще на все URL**, включая лендинг, `/pricing`, `/signup` и вебхук Stripe. Это проверено запущенным продакшн-сервером, не выведено из чтения кода.
3. Логин/регистрация/выход не работают даже теоретически: `redirect()` внутри `try/catch` превращается в строку ошибки, а формы всё равно никак не показывают ошибку пользователю.
4. Ни один экран дашборда и настроек не подключён к своим server actions — это статичная вёрстка с неработающими кнопками.

То есть: в репозитории лежит хорошо структурированный набор библиотек (`lib/stripe`, `lib/ai`, `lib/actions`, валидация) и **отдельно** — набор нерабочих экранов. Слой между ними не соединён.

Отдельно важно: 30–40% файлов — это неиспользуемый код шаблона (генерация кода/переводы/саммари через OpenAI, `fetcher.ts`, `use-modal.ts`), который к продукту «AI-медиа агент» отношения не имеет, но тянет за собой поверхность атаки и расходы.

### Что уже работает

- Сборка TypeScript/Turbopack сама по себе успешна (`✓ Compiled successfully in 4.8s`) — ошибки только в отдельных файлах.
- Prisma-схема валидна, клиент генерируется.
- Supabase-клиенты (browser/server/proxy) написаны по актуальной документации `@supabase/ssr`, включая корректную работу с cookie jar.
- Zod-валидация на входе всех server actions присутствует и написана аккуратно.
- Stripe-слой (`billing.ts`, `checkout.ts`) структурно корректен: customer per user, метаданные `userId` проставляются и в сессию, и в подписку.
- Lint проходит (5 warnings, 0 errors), tailwind v4 настроен через `@theme inline` корректно.

### Что выглядит как прототип

- Все страницы дашборда и настроек — вёрстка без обработчиков.
- `/dashboard/ai` и `/dashboard/billing` есть в навигации, но таких маршрутов не существует (404).
- Три файла пустые: `src/app/dashboard/loading.tsx`, `src/components/shared/spinner.tsx`, `src/components/shared/empty-state.tsx`.
- Кнопка «Subscribe» на `/pricing` ведёт на `/dashboard`, а не в Stripe Checkout.
- `hasActiveSubscription()` — заглушка, возвращающая `false` всегда.

---

## 1. Стек и архитектура

| Слой      | Что используется                               | Оценка                         |
| --------- | ---------------------------------------------- | ------------------------------ |
| Framework | Next.js 16.0.1, App Router, Turbopack          | актуально                      |
| Язык      | TypeScript 5, `strict: true`                   | хорошо                         |
| Runtime   | React 19.2                                     | актуально                      |
| БД        | PostgreSQL                                     | —                              |
| ORM       | Prisma 5.19                                    | актуально, но 6.x уже вышла    |
| Auth      | Supabase Auth (`@supabase/ssr` 0.5.2)          | актуально                      |
| Платежи   | Stripe 17.5, API version `2025-02-24.acacia`   | актуально                      |
| AI        | OpenAI SDK 4.77, напрямую                      | один провайдер, без абстракции |
| UI        | Tailwind CSS v4 + shadcn/ui (new-york) + Radix | актуально                      |
| Состояние | Server Actions + Zustand 5                     | Zustand почти не используется  |
| Валидация | Zod 3.23                                       | хорошо                         |
| Env       | `@t3-oss/env-nextjs`                           | хорошо                         |
| Деплой    | Vercel (`vercel.json`, region `iad1`)          | —                              |
| Тесты     | **отсутствуют полностью**                      | критично                       |
| CI        | **отсутствует** (нет `.github/`)               | критично                       |

### Фактическая архитектура

```
Browser
  │
  ├─→ src/proxy.ts  (Next 16 proxy = бывший middleware)
  │     └─→ lib/supabase/middleware.ts  → обновление сессии + редирект
  │
  ├─→ src/app/**/page.tsx  (Server Components)
  │     ├─→ lib/auth.ts        (getCurrentUser, cached)
  │     └─→ lib/db.ts          (Prisma, напрямую из страницы)
  │
  ├─→ lib/actions/*.ts  ("use server")
  │     ├─→ lib/validation/*   (Zod)
  │     ├─→ lib/ai/client.ts   → OpenAI
  │     ├─→ lib/stripe/*       → Stripe
  │     └─→ lib/db.ts          → Prisma
  │
  └─→ app/api/webhooks/stripe/route.ts → lib/stripe/webhook.ts → Prisma
```

Архитектура выбрана верно для этого класса продукта: server actions вместо REST-слоя, прямой доступ к Prisma из RSC, единственный API route — вебхук. Менять её не нужно. Проблемы — в реализации, не в схеме.

**Главный архитектурный пробел:** страницы обращаются к Prisma напрямую (`dashboard/page.tsx:8`, `dashboard/settings/page.tsx:16`), минуя `lib/actions/`. В результате одна и та же логика (подсчёт usage за месяц) существует в трёх местах с тремя разными реализациями границы месяца.

### Контекст: незамёрженный стек PR #1–#9

В репозитории открыты 9 draft-PR (`feat/content-engine-schema` → … → `feat/pipeline-orchestrator`), реализующих контент-движок продукта: Prisma-модели контента, Europe PMC research, `LLMProvider` (Claude + OpenAI), Script agent, Hook Optimizer, Telegram publishing, ElevenLabs TTS, Supabase Storage, оркестратор.

Этот аудит покрывает `main`, то есть то, что реально лежит в репозитории и деплоится. PR-стек к затронутым здесь файлам почти не прикасается (он добавляет `src/lib/content-engine/**` и дописывает `prisma/schema.prisma` и `src/env.mjs`), поэтому исправления ниже можно вести параллельно со стеком. Два пересечения, которые надо держать в голове:

- `src/env.mjs` — стек добавляет туда `ANTHROPIC_API_KEY`, `LLM_PROVIDER`, `ELEVENLABS_API_KEY`. Любая моя правка этого файла даст конфликт при мерже.
- `prisma/schema.prisma` — стек добавляет модели контента. То же самое.

Отдельно: PR #3 уже вводит правильную абстракцию `LLMProvider`, которой не хватает в `main` (см. AI-01). При мерже стека `src/lib/ai/` на `main` становится мёртвым кодом-дублёром.

---

## 2. CRITICAL — проект не работает

### C-01 · `npm run build` падает на ошибке типов

**Файл:** `src/lib/stripe/webhook.ts:21`

```ts
data: event.data as unknown as Record<string, unknown>,
```

`Prisma.InputJsonValue` не принимает `Record<string, unknown>`. Фактический вывод сборки:

```
Failed to compile.
./src/lib/stripe/webhook.ts:21:7
Type error: Type 'Record<string, unknown>' is not assignable to type 'JsonNull | InputJsonValue'.
```

**Следствие:** деплой невозможен вообще. Любой `vercel deploy` падает.
**Критичность:** CRITICAL.

### C-02 · Пустой `loading.tsx` ломает пререндер

**Файл:** `src/app/dashboard/loading.tsx` — 0 байт.

После обхода C-01 сборка падает на следующем шаге:

```
Error occurred prerendering page "/dashboard".
Error: The default export is not a React Component in "/dashboard/loading"
```

Файл-конвенция без default-экспорта — это ошибка сборки, а не «пока пусто».
Ещё два пустых файла — `src/components/shared/spinner.tsx` и `src/components/shared/empty-state.tsx` — сборку не ломают только потому, что их никто не импортирует.

**Критичность:** CRITICAL.

### C-03 · Proxy редиректит на `/login` вообще всё, включая лендинг, регистрацию и вебхук Stripe

**Файлы:** `src/proxy.ts:18` (matcher), `src/lib/supabase/middleware.ts:41-50` (логика).

Matcher исключает только статику:

```
"/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)"
```

А логика редиректит всё, что не начинается с `/login` или `/auth`:

```ts
if (!user && !pathname.startsWith("/login") && !pathname.startsWith("/auth")) {
  return NextResponse.redirect(url); // url.pathname = "/login"
}
```

Проверено на собранном приложении (`next start`, анонимные запросы):

```
GET  /                      → 307 → http://localhost:3111/login
GET  /pricing               → 307 → http://localhost:3111/login
GET  /signup                → 307 → http://localhost:3111/login
POST /api/webhooks/stripe   → 307 → http://localhost:3111/login
GET  /dashboard             → 307 → http://localhost:3111/login
```

**Следствия, каждое само по себе критичное:**

- Лендинг и прайсинг недоступны никому, кто не залогинен. Это весь входящий трафик.
- **Зарегистрироваться физически невозможно** — `/signup` редиректит на `/login`, а с `/login` зарегистрироваться некуда.
- **Вебхук Stripe мёртв.** Stripe получает 307, не следует за редиректом и считает доставку неуспешной. Значит `Subscription` в базе никогда не создаётся и не обновляется: оплата проходит, доступа пользователь не получает, деньги списываются. Это прямая потеря денег и повод для чарджбэков.
- SEO: поисковики видят редирект на логин со всех страниц.

**Критичность:** CRITICAL. Это ошибка №1 в проекте.

### C-04 · `redirect()` внутри `try/catch` ломает вход, регистрацию и выход

**Файлы:** `src/lib/utils/error.ts:89-105`, `src/lib/actions/auth.ts:30, 74, 87`.

`handleServerAction` ловит вообще всё:

```ts
try {
  const data = await action();
  return { data };
} catch (error) {
  if (error instanceof Error) return { error: error.message };
  ...
}
```

А `signIn`/`signUp`/`signOut` вызывают `redirect()` **внутри** этого колбэка. В Next.js `redirect()` реализован через бросок специальной ошибки с `digest === "NEXT_REDIRECT"`. Она — обычный `Error`, поэтому перехватывается и возвращается как `{ error: "NEXT_REDIRECT" }`.

**Следствие:** после успешного ввода логина и пароля пользователь остаётся на `/login`. Выход не выводит из аккаунта.
**Критичность:** CRITICAL.

### C-05 · Формы входа и регистрации не показывают ошибок

**Файлы:** `src/app/login/page.tsx:14-18`, `src/app/signup/page.tsx:7-11`.

```ts
async function handleSignIn(formData: FormData) {
  "use server";
  const { signIn } = await import("@/lib/actions/auth");
  await signIn(formData); // результат выбрасывается
}
```

`signIn` возвращает `{ data?, error? }`, но результат нигде не используется, а формы — Server Components без `useActionState`. Неверный пароль, занятый email, слабый пароль — всё это приводит к тому, что страница просто перезагружается без единого сообщения.

**Критичность:** CRITICAL (продуктовая блокировка: пользователь не понимает, что произошло, и уходит).

### C-06 · Регистрация может создать пользователя в Supabase без строки в БД

**Файл:** `src/lib/actions/auth.ts:48-71`.

`supabase.auth.signUp()` и `prisma.user.create()` — две несвязанные операции без транзакции и без идемпотентности. Если Prisma-вставка падает (БД недоступна, дубль по `email`), в Supabase Auth пользователь уже создан. Итог: человек может залогиниться, но `prisma.user.findUnique` вернёт `null` → `getUserProfile` бросит «User not found», настройки покажут пустоту, `dashboard` отрендерит нули.

Плюс: при включённом подтверждении email (дефолт в Supabase) `data.user` уже есть, а сессии ещё нет — код всё равно делает `redirect("/dashboard")`, куда пользователь попасть не может.

Правильное решение для Supabase — создавать строку в `users` по вебхуку/триггеру `auth.users`, а не в server action.

**Критичность:** CRITICAL (рассинхрон источников правды по пользователям).

### C-07 · Вебхук Stripe не идемпотентен и помечает обработанными чужие события

**Файл:** `src/lib/stripe/webhook.ts:18-66`.

Три отдельные проблемы в одном месте:

1. **Нет дедупликации.** `WebhookEvent.id` — это `uuid()`, а не `event.id` от Stripe. Stripe гарантирует _at-least-once_ доставку и ретраит. Один и тот же `invoice.payment_succeeded` обработается столько раз, сколько его прислали.

2. **`updateMany` по типу события.** Пометка «обработано» выглядит так:

```ts
await prisma.webhookEvent.updateMany({
  where: { type: event.type, processed: false },
  data: { processed: true },
});
```

Это помечает обработанными **все** необработанные события этого типа, включая те, что упали раньше с ошибкой. Ровно так же в `catch` ошибка записывается **во все** необработанные события того же типа. Журнал вебхуков становится недостоверным — а это единственный след того, что произошло с платежами.

3. **`handleSubscriptionDeleted` использует `update`, а не `upsert`/`updateMany`.** Если строки нет (а её может не быть — см. C-03), Prisma бросает `P2025`, route возвращает 400, Stripe ретраит до исчерпания, потом сдаётся навсегда.

**Критичность:** CRITICAL (деньги + недостоверный аудит платежей).

### C-08 · Проверка подписки — заглушка, возвращающая `false`

**Файл:** `src/lib/auth.ts:42-53`.

```ts
export async function hasActiveSubscription(): Promise<boolean> {
  const user = await getCurrentUser();
  if (!user) return false;
  // TODO: Implement subscription check with Prisma
  return false;
}
```

Единственная функция, которая должна отвечать «есть ли у пользователя доступ», всегда отвечает «нет». Сейчас это безопасный дефолт только потому, что её никто не вызывает — то есть **платный доступ не разграничен вообще ничем**.

**Критичность:** CRITICAL для монетизации.

---

## 3. HIGH — безопасность и деньги

### S-01 · Пользователь может оформить подписку по любому Price ID

**Файлы:** `src/lib/actions/subscription.ts:13-33`, `src/lib/validation/subscription.ts:7-9`.

Валидация — `z.string().min(1)`. Дальше `priceId` уходит в `stripe.checkout.sessions.create()` без проверки, что это одна из **наших** цен.

Любой залогиненный пользователь может вызвать server action с произвольным `price_...` из нашего Stripe-аккаунта: архивной ценой, тестовой ценой в 1 ₽, внутренней ценой для партнёров. Подписка создастся, вебхук её примет, `stripePriceId` запишется.

**Фикс:** сверять `priceId` с allow-list из `PRICING_PLANS` перед вызовом Stripe.
**Критичность:** HIGH (прямая финансовая эксплуатация).

### S-02 · Пользователь может выбрать любую модель OpenAI

**Файлы:** `src/lib/validation/ai.ts:9` (`model: z.string().optional()`), `src/lib/ai/client.ts:28`.

`model` приходит из `formData` и передаётся в OpenAI как есть. Пользователь бесплатного тарифа может запросить самую дорогую доступную модель. Разница в цене между дешёвым и флагманским tier — порядок величины и больше.

**Фикс:** `z.enum([...])` с явным списком разрешённых моделей, плюс привязка списка к тарифу.
**Критичность:** HIGH (неконтролируемые расходы).

### S-03 · Два AI-эндпоинта вообще не проверяют лимиты

**Файл:** `src/lib/actions/ai.ts`.

| Action                   | Проверка лимита | Запись в Usage |
| ------------------------ | --------------- | -------------- |
| `generateContent` (33)   | да (54)         | да             |
| `generateCode` (85)      | да (95)         | да             |
| `summarizeContent` (120) | **нет**         | да             |
| `translateText` (146)    | **нет**         | да             |

`summarizeContent` принимает до 10 000 символов на вход. Бесконечный цикл вызовов этого action — это неограниченный счёт от OpenAI. Лимит есть только «постфактум» в виде записи в `Usage`, которую никто не читает для этих двух функций.

**Критичность:** HIGH (неконтролируемые расходы).

### S-04 · Rate limiting отсутствует полностью

Класс `RateLimitError` объявлен (`src/lib/utils/error.ts:47`) и не используется ни разу. Ни один server action, ни вебхук, ни попытка логина не ограничены по частоте.

**Следствия:** брутфорс паролей; накрутка расходов на OpenAI; спам регистраций.
**Критичность:** HIGH.

### S-05 · Лимит считается по оценке токенов, а не по фактическому расходу

**Файл:** `src/lib/ai/utils.ts:60-62`.

```ts
export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}
```

OpenAI возвращает реальные `usage.prompt_tokens` / `completion_tokens` в каждом ответе, но `generateCompletion` их отбрасывает (`client.ts:39` берёт только `content`). Для кириллицы эвристика «4 символа = 1 токен» занижает расход примерно вдвое — то есть биллинг систематически недосчитывает потребление именно на целевом языке продукта.

**Критичность:** HIGH (биллинг занижает расходы на основном языке).

### S-06 · API-ключи хранятся в открытом виде

**Файл:** `prisma/schema.prisma:88` — `key String @unique`.

Модель `ApiKey` есть, кода к ней нет. Но схема уже закладывает хранение секрета в открытом виде. Утечка дампа БД = утечка всех пользовательских ключей.

**Фикс до первого использования:** хранить `keyHash` (SHA-256) + `keyPrefix` для отображения.
**Критичность:** HIGH (пока не эксплуатируется — кода нет).

### S-07 · Текст любой ошибки показывается пользователю

**Файлы:** `src/app/error.tsx:11`, `src/lib/utils/error.ts:100-102`.

```tsx
<p className="text-lg text-gray-500">{error.message}</p>
```

`handleServerAction` возвращает `error.message` любой ошибки, включая ошибки Prisma (содержат имена таблиц и колонок), ошибки Stripe и внутренние исключения. `error.tsx` рендерит это в открытую.

Также в `error.tsx` кнопка вызывает `router.refresh()` вместо переданного в пропсах `reset()` — граница ошибки не сбрасывается, экран ошибки остаётся.

**Критичность:** HIGH (утечка внутренней информации).

### S-08 · Смена пароля реализована через повторный логин

**Файл:** `src/lib/actions/auth.ts:131-138`.

Проверка текущего пароля сделана вызовом `signInWithPassword`. Это (а) выпускает новую сессию как побочный эффект, (б) превращает форму настроек в неограниченный по частоте оракул проверки паролей (см. S-04).

Плюс: `updatePasswordSchema` объявлена в `validation/auth.ts:28` со сверкой `newPassword === confirmPassword` — и **не используется**. `updatePassword` принимает голые строки без валидации, то есть требования к сложности пароля при смене не применяются вовсе.

**Критичность:** HIGH.

### S-09 · Нет security-заголовков

**Файл:** `next.config.ts` — пустой:

```ts
const nextConfig: NextConfig = {
  /* config options here */
};
```

Отсутствуют `Content-Security-Policy`, `Strict-Transport-Security`, `X-Frame-Options`, `X-Content-Type-Options`, `Referrer-Policy`, `Permissions-Policy`. Также не настроен `images.remotePatterns` — а `User.avatarUrl` принимает произвольный URL (`validation/user.ts:10`), то есть при выводе аватара через `next/image` это станет SSRF-вектором.

**Критичность:** HIGH.

### S-10 · `WebhookEvent.data` хранит полные payload'ы бессрочно

**Файл:** `src/lib/stripe/webhook.ts:18-23`.

В `data Json` пишется весь `event.data`, включая email, имя, адрес для выставления счёта, последние 4 цифры карты. Без TTL, без ретеншн-политики, без шифрования. Для платящей аудитории это персональные данные под соответствующее регулирование.

**Критичность:** HIGH.

### S-11 · Удаление аккаунта не удаляет пользователя из Supabase Auth

**Файл:** `src/lib/actions/user.ts:108-126`.

```ts
await prisma.user.delete({ where: { id: authUser.id } });
// Delete from Supabase Auth
// Note: This requires admin privileges
// await supabase.auth.admin.deleteUser(authUser.id);
```

После «удаления» аккаунт в Supabase Auth остаётся и может логиниться — в приложение без строки в БД. Заодно при активной подписке Stripe она не отменяется: списания продолжаются после удаления аккаунта.

Это же нарушает право на удаление данных.

**Критичность:** HIGH.

### S-12 · `prisma/migrations/` в `.gitignore`

**Файл:** `.gitignore:35-36`.

```
# Prisma
prisma/migrations/
```

История миграций не версионируется. Для продакшн-SaaS это значит: нельзя воспроизвести схему, нельзя откатиться, нельзя прогнать миграции в CI, у разных окружений схема расходится молча. `db:push` без миграций допустим на прототипе, но не на платящих пользователях.

**Критичность:** HIGH.

### S-13 · Изоляция данных держится только на `where: { userId }`

Каждый запрос вручную фильтрует по `userId` из сессии. Это работает — я проверил все 14 обращений к Prisma, ни в одном нет обращения к чужим данным. Но защита держится исключительно на дисциплине: один забытый `where` = утечка.

При этом README заявляет «Row Level Security with Supabase» — **RLS нигде не настроен**, и с Prisma через прямое подключение к БД он бы и не применялся (Prisma ходит под service-ролью в обход RLS).

`GeneratedContent.userId` (`schema.prisma:116`) вообще не имеет `@relation` — нет внешнего ключа, нет каскадного удаления. При удалении пользователя его сгенерированный контент остаётся в базе навсегда.

**Критичность:** HIGH (архитектурный риск + мёртвые данные после удаления).

---

## 4. Оценка по категориям

### Architecture — HIGH

**Сейчас:** App Router + server actions + прямой Prisma из RSC. Выбор верный.
**Проблемы:** страницы ходят в Prisma мимо `lib/actions/`; логика «начало месяца» продублирована в трёх местах тремя способами (`ai/utils.ts:25-27`, `actions/user.ts:82-84`, `dashboard/page.tsx:12`), все три — в локальной таймзоне сервера; нет слоя сервисов между actions и БД; `lib/db.ts` и `lib/prisma/index.ts` — два разных способа импортировать один клиент; `.eslintrc.json` и `eslint.config.mjs` сосуществуют, причём первый (legacy) ESLint 9 игнорирует.
**Надо:** вынести доступ к данным из страниц в `lib/actions/`, оставить один путь импорта Prisma, удалить `.eslintrc.json`, свести период биллинга к одной UTC-функции.

### Code Quality — HIGH

**Сейчас:** `strict: true`, Zod везде на входе, lint без ошибок.
**Проблемы:** 54 файла не соответствуют собственному prettier-конфигу (`prettier --check` фейлится); 5 lint-warnings, из них `PRO_TIER_LIMIT` (`actions/ai.ts:28`) и `contentGenerationPrompt` (`actions/ai.ts:14`) — объявлены и никогда не используются; три пустых файла; мёртвый код (`utils/fetcher.ts` — 129 строк, ни одного импорта; `hooks/use-modal.ts`; `hooks/use-theme.ts` — тема нигде не применяется, переключателя нет; `logger.ts` — 63 строки, при этом везде `console.*`); типы дублируются вручную вместо импорта из Prisma (`types/index.ts:13,18`).
**Надо:** `prettier --write`, удалить мёртвый код, прогнать логирование через `logger`, убрать ручные дубли типов.

### UI/UX — CRITICAL

**Сейчас:** shadcn/ui, аккуратные примитивы, связная цветовая схема в oklch.
**Проблемы:**

- Класс `container` используется в navbar, лендинге, прайсинге, дашборде — но в Tailwind v4 `container` **не центрируется и не имеет паддингов** без явной настройки, а `tailwind.config` в проекте отсутствует вовсе (`components.json` → `"config": ""`). Контент прижат к левому краю и вплотную к краям экрана.
- `globals.css:38-40`: `--font-sans: "var(--font-geist-sans)", sans-serif;` — `var()` внутри строковых кавычек не раскрывается, это невалидное значение; шрифт Geist в проекте не подключён (подключён Inter). Плюс `@theme inline { --font-sans: var(--font-sans) }` — самоссылка.
- Два одинаковых блока `@layer base` (строки 167–175 и 184–191) дублируют друг друга.
- `--destructive-foreground` задан в `hsl()`, все остальные — в `oklch()`.
- Кнопки «Save Changes», «Update Password», «Delete» на `/dashboard/settings` не подключены ни к чему.
- Кнопка «Sign Out» в сайдбаре не подключена ни к чему.
- «Subscribe» на `/pricing` ведёт на `/dashboard` вместо Checkout.
- Navbar всегда показывает «Sign In»/«Get Started», даже залогиненному.
- Нет тёмной темы на практике: класс `.dark` описан, но `use-theme.ts` ни к чему не привязан.
- Нет `not-found.tsx`, нет корневого `loading.tsx`, нет toast-уведомлений ни на одном действии (хотя `<Toaster />` смонтирован).
- Нет onboarding, нет empty states, нет skeleton'ов.
- Тексты шаблонные: «SaaS Template», «Built with Next.js, Supabase, Stripe, and OpenAI», ссылки на `twitter.com/yourusername` и `github.com/yourusername/template` (`config.ts:13-14`).

**Надо:** починить `container` и шрифты, подключить формы к actions, добавить toast'ы и состояния загрузки/пустоты/ошибки, перебрендировать.

### Mobile — CRITICAL

**Сейчас:** лендинг и прайсинг адаптивны (`md:`/`lg:` брейкпоинты расставлены).
**Проблемы:** `DashboardLayout` (`dashboard/layout.tsx:17-22`) — `flex h-screen` с сайдбаром `w-64` без скрытия и без бургер-меню (`sidebar.tsx:43`). На экране 375px сайдбар занимает 68% ширины. Дашборд на телефоне непригоден. Нет `viewport` export в `layout.tsx`.
**Надо:** сайдбар в Sheet/Drawer на мобильных, добавить `viewport`.

### Authentication — CRITICAL

**Сейчас:** Supabase Auth, cookie-сессии, `@supabase/ssr` по документации, `getCurrentUser` обёрнут в `cache()`.
**Проблемы:** C-03 (proxy редиректит всё), C-04 (redirect в catch), C-05 (нет ошибок в формах), C-06 (рассинхрон Supabase↔БД), S-08 (смена пароля). Плюс: нет маршрута `/auth/callback`, хотя `resetPassword` (`actions/auth.ts:104`) на него ссылается — сброс пароля и подтверждение email не завершаются; нет страницы «забыли пароль»; нет OAuth; нет MFA; `requireAuth()` (`auth.ts:31`) объявлена и нигде не используется.
**Надо:** весь блок C-03…C-06 + маршрут `/auth/callback` + страница восстановления пароля.

### Database — HIGH

**Сейчас:** Prisma + PostgreSQL, snake_case маппинг, каскады на `User`, индексы на `[userId, createdAt]` есть.
**Проблемы:** S-12 (миграции в gitignore), S-13 (`GeneratedContent` без FK), нет модели плана/тарифа (плана в `Subscription` нет вовсе — только `stripePriceId`), нет `@@index` на `Subscription.stripeSubscriptionId` (а `handleInvoicePaymentFailed:139` ищет именно по нему → seq scan), `seed.ts` пустой.
**Надо:** включить миграции в git, добавить FK и индексы, ввести `plan` на подписке.

### AI — HIGH

**Сейчас:** OpenAI SDK, промпты вынесены в отдельный модуль, usage пишется в БД.
**Проблемы:** вызовы OpenAI размазаны — `client.ts` вызывается напрямую из четырёх actions, слоя сервиса нет; нет таймаутов, нет ретраев, нет structured output, нет валидации ответа; `DEFAULT_MODEL = "gpt-4-turbo-preview"` (`client.ts:11`) — устаревшая preview-модель; `generateStreamingCompletion` (`client.ts:45`) написана и нигде не используется; S-02, S-03, S-05; **вся реализованная AI-функциональность (генерация текста, кода, саммари, переводы) не относится к продукту** «AI-медиа агент» — это демо шаблона.
**Надо:** ввести AI service layer (в PR #3 он уже есть как `LLMProvider` — при мерже стека `src/lib/ai/` надо схлопнуть в него), таймауты+ретраи, реальный подсчёт токенов, allow-list моделей.

### Security — CRITICAL

Разобрано в разделе 3. Сводно: S-01 (любой Price ID), S-02 (любая модель), S-03 (безлимитные AI-эндпоинты), S-04 (нет rate limiting), S-06 (ключи в открытом виде), S-07 (утечка ошибок), S-09 (нет заголовков), S-10 (PII бессрочно), S-11 (удаление не удаляет), S-13 (изоляция «на честном слове»).

Отдельно: XSS-поверхность мала — нигде нет `dangerouslySetInnerHTML`, весь вывод идёт через JSX. SQL-инъекции исключены — нет ни одного `$queryRaw`/`$executeRaw`. CSRF частично закрыт механизмом Server Actions Next.js (проверка Origin), но README заявляет «CSRF protection» как отдельную реализованную фичу, чего нет.

### Performance — MEDIUM

**Сейчас:** RSC по умолчанию, `cache()` на `getCurrentUser`, `Promise.all` в `dashboard/page.tsx:7`, клиентских компонентов всего два (`sidebar`, `toaster`).
**Проблемы:** нет N+1 (запросов слишком мало, чтобы он возник), но: нет пагинации нигде (`PAGINATION` в `constants.ts:40` объявлен и не используется); нет кеширования (`revalidate`, `unstable_cache`) — дашборд бьёт в БД на каждый запрос; `Usage` агрегируется полным сканом по диапазону без materialized-счётчика — на объёме это станет проблемой; `next/image` не используется нигде, `images` не настроен; бандл не анализировался (`@next/bundle-analyzer` не подключён); `vercel.json` ставит `maxDuration: 30` на все API-роуты, включая вебхук, которому нужно отвечать за секунды.
**Надо:** не оптимизировать преждевременно. Добавить пагинацию там, где появятся списки, и кеш на дашборд.

### Error Handling — HIGH

**Сейчас:** иерархия `AppError` написана грамотно (`utils/error.ts`), `error.tsx` существует.
**Проблемы:** ни один из классов `AuthenticationError`/`AuthorizationError`/`ValidationError`/`NotFoundError`/`RateLimitError` нигде не выбрасывается — везде голый `throw new Error(...)`; `handleServerAction` ловит `redirect()` (C-04); `formatErrorResponse` не используется; нет `global-error.tsx`; нет Sentry/трейсинга; `ZodError` не разворачивается в пофайловые сообщения — пользователь получает сырой текст исключения.
**Надо:** вынести `redirect()` из-под `handleServerAction`, начать выбрасывать типизированные ошибки, маппить `ZodError` в поля формы, убрать сырые сообщения из UI.

### Payments — CRITICAL

Разобрано: C-03 (вебхук недоступен), C-07 (нет идемпотентности), S-01 (любой Price ID). Дополнительно: `PRICING_PLANS` (`stripe/pricing.ts:38,54`) читает `process.env.STRIPE_PRICE_ID_PRO` / `..._ENTERPRISE`, которых **нет ни в `env.mjs`, ни в `env.example`** — то есть всегда `""`, а `getPlanByPriceId("")` (`pricing.ts:67`) вернёт при этом план Free. `payment_method_types: ["card"]` (`checkout.ts:25`) жёстко ограничивает способы оплаты. Нет обработки `checkout.session.completed`. Нет страницы `/dashboard/billing`, хотя она в обоих навигационных конфигах.

### Subscription System — CRITICAL

Модель `Subscription` есть, статусы маппятся корректно (`webhook.ts:154-170`), портал Stripe подключён. Но: нет понятия плана (`free`/`pro`/`business`) — только `stripePriceId`; нет entitlements; лимиты заданы в двух местах с разными значениями (`config.ts:59-75` и `actions/ai.ts:27-28`) и не связаны с подпиской ни в одном месте кода; `hasActiveSubscription()` — заглушка (C-08); проверки `currentPeriodEnd` при выдаче доступа нет нигде.

Фактически: **платящий пользователь получает ровно те же 10 000 токенов, что и бесплатный.**

### Analytics — CRITICAL (отсутствует)

Нет продуктовой аналитики, нет отслеживания событий, нет воронки регистрация→активация→оплата, нет логирования AI-расходов в разрезе пользователя/модели. Для SaaS, который планирует монетизацию, это означает невозможность понять, что происходит.

### SEO — HIGH

`metadataBase` и `title.template` заданы (`layout.tsx:12-19`) — это хорошо. Но: нет `openGraph`/`twitter` карточек; `ogImage` ссылается на `/og.png`, которого нет в `public/`; нет `robots.ts`; нет `sitemap.ts`; нет `manifest`; нет структурированных данных; `lang="en"` при русскоязычном продукте; нет `viewport`. И главное — **C-03 делает SEO бессмысленным**: краулер получает 307 на логин со всех страниц.

### Deployment — MEDIUM

`vercel.json` корректен, `build` включает `prisma generate`, `postinstall` тоже. Но: нет CI (`.github/` отсутствует) — ни один из прогонов lint/typecheck/build не выполняется автоматически; нет `healthcheck`-эндпоинта; нет `instrumentation.ts`; нет разделения окружений (preview/staging/production); `env.example` называется так, а README (строка ~40) велит копировать `.env.example` — файла с таким именем нет.

`env.mjs` требует **все** переменные как обязательные, включая `OPENAI_API_KEY` и все ключи Stripe. Поднять окружение без Stripe-аккаунта невозможно даже для локальной разработки лендинга.

### Scalability — MEDIUM

Stateless-приложение на Vercel масштабируется само. Ограничители: Prisma без connection pooling (для Supabase нужен pgbouncer/`?pgbouncer=true`, в документации это не упомянуто); нет очередей — все AI-вызовы синхронные внутри server action при `maxDuration: 30`, чего для длинной генерации не хватит; агрегация `Usage` полным сканом; нет мультитенантности (модели `Organization` на `main` нет — она появляется только в PR #1).

---

## 5. Сводная таблица

| Категория           | Уровень  | Одной строкой                                                    |
| ------------------- | -------- | ---------------------------------------------------------------- |
| Architecture        | HIGH     | Скелет верный; данные тянутся мимо слоя actions, дубли конфигов  |
| Code Quality        | HIGH     | 54 файла вне формата, мёртвый код, 3 пустых файла                |
| UI/UX               | CRITICAL | `container` не работает в v4, формы ни к чему не подключены      |
| Mobile              | CRITICAL | Дашборд непригоден на телефоне                                   |
| Authentication      | CRITICAL | Регистрация недостижима, логин не редиректит, ошибки не видны    |
| Database            | HIGH     | Миграции вне git, нет FK на контенте, нет плана в подписке       |
| AI                  | HIGH     | Нет service layer, любая модель, 2 эндпоинта без лимитов         |
| Security            | CRITICAL | Любой Price ID, нет rate limiting, нет заголовков, PII бессрочно |
| Performance         | MEDIUM   | Реальных узких мест пока нет; нет кеша и пагинации               |
| Error Handling      | HIGH     | `redirect()` съедается catch'ем, сырые ошибки в UI               |
| Payments            | CRITICAL | Вебхук недоступен, не идемпотентен, Price ID не проверяется      |
| Subscription System | CRITICAL | Платный = бесплатный, `hasActiveSubscription` — заглушка         |
| Analytics           | CRITICAL | Отсутствует полностью                                            |
| SEO                 | HIGH     | Нет OG/robots/sitemap; всё равно бесполезно из-за C-03           |
| Deployment          | MEDIUM   | Нет CI, нет healthcheck, все env обязательны                     |
| Scalability         | MEDIUM   | Нет пулинга, нет очередей для долгих AI-задач                    |

---

## 6. Технический долг и лишний код

**Удалить без сожалений:**

- `src/lib/utils/fetcher.ts` (129 строк) — ни одного импорта; в архитектуре на server actions клиентский fetch-хелпер не нужен.
- `.eslintrc.json` — ESLint 9 использует flat config, этот файл мёртв и вводит в заблуждение.
- `src/hooks/use-modal.ts` — не используется.
- `src/lib/ai/prompts/` промпты для кода/переводов/саммари + соответствующие actions — демо шаблона, к продукту отношения не имеют.
- `generateStreamingCompletion` (`client.ts:45-73`) — не используется.
- Дубль `@layer base` в `globals.css:184-191`.
- `public/next.svg`, `public/vercel.svg`, `public/file.svg`, `public/globe.svg`, `public/window.svg` — ассеты дефолтного шаблона Next.

**Дублирование:**

- Лимиты тарифов: `config.ts:59-75` ↔ `actions/ai.ts:27-28`.
- Prisma-клиент: `lib/db.ts` ↔ `lib/prisma/index.ts`.
- Типы: `types/index.ts:13,18` дублируют enum'ы Prisma вручную.
- «Начало месяца»: три реализации в трёх файлах.
- Навигация: `config.ts:18-37` (`dashboardConfig`) ↔ `sidebar.tsx:16-37` — два списка маршрутов, которые надо держать синхронными; `config.ts` при этом не используется.

**Заявлено в README, но не реализовано:** Row Level Security, CSRF protection (отдельно), Automatic migrations, `npm run test` (скрипта нет), `.env.example` (файл называется `env.example`).

---

## 7. Что проверялось и как

| Проверка            | Команда                  | Результат                         |
| ------------------- | ------------------------ | --------------------------------- |
| Типы                | `npx tsc --noEmit`       | 1 ошибка (`stripe/webhook.ts:21`) |
| Линт                | `npx eslint .`           | 0 errors, 5 warnings              |
| Формат              | `npx prettier --check .` | 54 файла вне формата              |
| Сборка              | `npx next build`         | **падает** (C-01, затем C-02)     |
| Сборка после обхода | `npx next build`         | успешно, 10 страниц               |
| Поведение рантайма  | `npx next start` + curl  | **все маршруты → 307 `/login`**   |
| Prisma              | `npx prisma generate`    | успешно                           |

**Не проверялось** (нет доступа в этой среде): живые вызовы OpenAI, Stripe и Supabase; реальная БД; поведение в браузере (визуальная вёрстка, мобильная раскладка) — выводы по UI сделаны по коду и по тому, как Tailwind v4 обрабатывает `container` и `@theme`.
