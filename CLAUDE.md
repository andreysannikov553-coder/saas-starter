# saas-starter — notes for Claude sessions

## Several sessions work on this repo at once

Multiple Claude sessions (plus Jarvis-dispatched ones) touch this repository
in parallel, some in `.claude/worktrees/*`. Decisions therefore live in git
history, not in any one session's context. **Before starting work, read it:**

```bash
git log --oneline -10                          # this checkout
git branch -a --sort=-committerdate | head -8  # where the action is
git log --oneline -10 <that branch>            # what the others decided
```

As of 2026-10-04 the active branch is `worktree-feat-video-publishing`
(content-engine video publishing + the kinetic renderer), ahead of
`chore/add-topic-script`. That name will go stale — trust the commands above
over this paragraph.

If you push to a branch another session is also on, say so in the commit
message rather than assuming it will be read live.

### The git stash stack is shared

It is shared across every worktree and the main checkout, so a bare
`git stash` / `git stash pop` can swallow or resurrect someone else's work.
Set work aside with a temporary WIP commit instead. If you must stash, use
`git stash push -u -m "<unique-tag>"` and restore with
`git stash apply <sha>`, never `pop`.

> 2026-10-04: `stash@{0}` ("pre-merge stash before worktree-feat-video-publishing")
> holds Andrey's renderer WIP that is **already committed** in `3aae962`.
> Popping it only produces conflicts (`env.example` / `src/env.mjs` in it are
> older). Leave it alone; it is Andrey's to drop.

## Commands

```bash
npm test             # node:test via tsx, SKIP_ENV_VALIDATION=1
npm run type-check   # tsc --noEmit  (note: "type-check", not "typecheck")
npm run lint         # eslint; 5 pre-existing warnings are expected, 0 errors
```

Run all three before calling work done. There is no CI gate doing it for you.

## Content engine (`src/lib/content-engine`)

Pipeline: topics -> research (Europe PMC) -> claims -> script -> hooks ->
render -> publish. Niche is **health AND sport** — both halves are seeded
explicitly in `topics/trend-scanner.ts` and guarded by a test; keep it that
way.

Publishing conventions, shared by every platform module in `publishing/`:

- Platform credentials live in `PlatformAccount.credentials` (JSON), **not**
  in env. The `YOUTUBE_*` / `TIKTOK_*` env vars are read only by the
  `scripts/add-*-account.ts` setup scripts.
- Every publish upserts a `Publication` keyed on
  `(videoId, platformAccountId)` and is idempotent: an already-`PUBLISHED`
  row with an `externalId` short-circuits before the platform is called.
  Keep that, or a pipeline re-run double-posts to a real account.
- Tests mock `fetch` and `@/lib/db` rather than touching a network or a
  database — follow `publishing/youtube.test.ts` or `social.test.ts`.

**Known gap:** nothing in the codebase sets `Video.assetUrl`. Renders land in
a local file via `scripts/make-kinetic-video.ts`, while YouTube/TikTok/Reels
publish _from_ `assetUrl`. Until a render -> storage -> `assetUrl` step
exists, the fan-out (`publishing/publish-all.ts`) reports those platforms as
`SKIPPED` and Instagram/Telegram fall back to slide carousels.
