# couple-pwa Copilot instructions

## Agent Interaction Rules (CRITICAL)

To ensure all agents behave consistently and reliably, follow these rules at all times:

- **NEVER stop to ask the user for the next step directly** — always use the `ask_question` / `vscode_askQuestions` tool to collect decisions or clarify next actions. Do not simply prompt in text and **NEVER END THE CHAT SESSION**.
- **ALWAYS ask what to do next** after completing a task, using the question tool, unless the next step is already specified or part of a batch. Then ask what to do next after everything
- **ALWAYS make frequent, meaningful git commits** — never batch unrelated changes into a single commit. Each commit should represent a logical, reviewable unit of work.
- These rules apply even after context compaction or agent handoff — re-read this file if unsure.
- If you are uncertain about the next step, default to asking the user via the question tool rather than making assumptions.
- When in doubt, prioritize clarity, explicitness, and user control.

## Build, test, and lint commands

- Package manager: `bun`
- Type-check and sync generated SvelteKit types: `bun run check`
- Lint: `bun run lint`
- Format: `bun run format`
- Production build: `bun run build`
- Full test flow: `bun run test`
- Unit tests in one-shot mode: `bun run test:unit -- --run`
- Run a single server test: `bun run test:unit -- --run --project server src/demo.spec.ts`
- Run a single browser/component test: `bun run test:unit -- --run --project client src/routes/page.svelte.spec.ts`
- Run a single Playwright test: `bun run test:e2e e2e/demo.test.ts`
- Storybook: `bun run storybook`
- Build Storybook: `bun run build-storybook`
- Drizzle workflows: `bun run db:generate`, `bun run db:push`, `bun run db:migrate`, `bun run db:studio`
- (Generated) Supabase Auth schema mirror: regenerated via `bun run auth:schema` (committed as `src/lib/server/db/auth.schema.ts` for Drizzle FK typing only)

## High-level architecture

- DuoSync is the live product at <https://cozy.ericssoncodes.com>: a private couples PWA built on SvelteKit 5 + Svelte 5 runes, deployed to Cloudflare Workers via `@sveltejs/adapter-cloudflare`. User-facing routes are `/welcome`, `/auth/sign-in`, `/onboarding/link`, `/pulse`, `/map`, `/moments`, `/moments/new`, `/daily`, `/timeline`, `/settings`. There are no `/demo/*` routes; the project-init demos were deleted in M-series.
- `wrangler.jsonc` enables `nodejs_compat` + `nodejs_als`; the `preview` script runs the built worker from `.svelte-kit/cloudflare/_worker.js`.
- Request handling in `src/hooks.server.ts`: Paraglide locale middleware → `handleSupabase` (creates per-request `@supabase/ssr` client, hydrates `event.locals.user` + `event.locals.couple`, writes the routing-hint cookie `ds_auth`). Auth is **Supabase Auth**, not Better-Auth.
- Pre-paint redirect: `static/route-stub.js` runs synchronously in `<head>` and `location.replace()`s signed-in users away from `/` and `/welcome` based on the `ds_auth` cookie. This eliminates the welcome-flash regardless of cache state.
- Database access: `src/lib/server/db/index.ts` builds a per-request **postgres-js** Drizzle client via `AsyncLocalStorage` (Cloudflare TCP sockets cannot survive across requests). Schema entry point is `src/lib/server/db/schema.ts`, which re-exports `auth.schema.ts` (generated mirror of `auth.users` for FK typing) plus `app.schema.ts`. Drizzle bypasses RLS as the privileged backend; mutations validate `locals.user` + `locals.couple` first.
- Realtime: Supabase Realtime over private channels per couple. Server REST broadcasts `location_update` / `ghost_change`; clients subscribe + presence-track but cannot INSERT broadcast. `heartbeat_tap` goes through `POST /api/realtime/tap`.
- Service worker (`src/service-worker.ts`): hand-written, **do not replace with workbox**. Stale-while-revalidate HTML, shell + image LRU caches, offline fallback, `WARM_ROUTES` precache (`/`, `/welcome`, `/auth/sign-in`). `isPrivatePath()` blocks `/auth/*` from cache **except** `/auth/sign-in`. `skipWaiting` + `clients.claim` only fire on a user-gesture `SKIP_WAITING` message.
- Internationalization: inlang/Paraglide. Source locales in `messages/{en,zh-hant}.json`; generated runtime in `src/lib/paraglide/**` (treat as generated).
- Tests are split across multiple Vitest projects (`vite.config.ts`): `client` (browser/component), `server`, `storybook`. Playwright runs independently from `e2e/` against the built preview worker; `playwright.config.ts` excludes `prod-smoke.test.ts` (which is reserved for `playwright.prod.config.ts`).

## Key conventions

- Treat `src/lib/paraglide/**` as generated code. Update `messages/*.json` or `project.inlang/**`, then let Paraglide regenerate the compiled runtime and message modules.
- Treat `src/lib/server/db/auth.schema.ts` as generated output from `bun run auth:schema`. If auth-related types or exports look wrong, regenerate this file before changing surrounding code.
- Keep server-only logic in `src/lib/server/**` and have routes consume `event.locals` populated in `src/hooks.server.ts` instead of duplicating session lookup logic inside each route.
- For unit tests, prefer `bun run test:unit -- --run ...` over bare `bun run test:unit`; the bare script starts Vitest in watch mode.
- When running a single Vitest test, include `--project client`, `--project server`, or `--project storybook` so the right environment is selected.
- Playwright e2e depends on the production build path, not the dev server. If an e2e spec fails before the browser opens, inspect `bun run build` and the Cloudflare `preview` path first.
- Every `href="/foo"` in a `.svelte` file must use `resolve('/foo')` from `$app/paths` — eslint-plugin-svelte's `no-navigation-without-resolve` will fail lint otherwise.
- See `plan.md` for the canonical routing/offline contract diagram and the active Phase-2 backlog. Historical phase chronicle (M/P/U/A/H/N/R/G series) is frozen at `docs/history.md` — not a live source of truth.
