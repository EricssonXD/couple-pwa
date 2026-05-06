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
- Better Auth schema generation: `bun run auth:schema`

## High-level architecture

- `README.md` describes the intended product as **DuoSync**, but the checked-in app is still mostly a SvelteKit starter plus integration demos. The current live surfaces are the default `/` page, `/demo/better-auth`, and `/demo/paraglide`.
- The app is a SvelteKit + Svelte 5 + TypeScript project deployed with `@sveltejs/adapter-cloudflare`. `svelte.config.js` enables `mdsvex`, and `wrangler.jsonc` plus the `preview` script are wired to run the built Cloudflare worker from `.svelte-kit/cloudflare/_worker.js`.
- Request handling is centralized in `src/hooks.server.ts`: Paraglide locale middleware runs first, then Better Auth resolves the session. Auth state is exposed through `event.locals.user` and `event.locals.session`, with the types declared in `src/app.d.ts`.
- Internationalization uses inlang/Paraglide. Source locale files live in `messages/*.json` and configuration lives in `project.inlang/settings.json`; generated runtime, server helpers, and message exports are emitted to `src/lib/paraglide` and imported by hooks and routes.
- Server-side auth and data access live under `src/lib/server`. `src/lib/server/auth.ts` configures Better Auth with the Drizzle adapter, and `src/lib/server/db/index.ts` creates a libSQL-backed Drizzle client. `src/lib/server/db/schema.ts` is the single schema entry point and re-exports the generated auth schema together with app tables.
- Tests are intentionally split across multiple surfaces. `vite.config.ts` defines separate Vitest projects for browser/component tests, server tests, and Storybook story tests; Playwright runs independently from `e2e/` and starts its own built preview server through `playwright.config.ts`.

## Key conventions

- Treat `src/lib/paraglide/**` as generated code. Update `messages/*.json` or `project.inlang/**`, then let Paraglide regenerate the compiled runtime and message modules.
- Treat `src/lib/server/db/auth.schema.ts` as generated output from `bun run auth:schema`. If auth-related types or exports look wrong, regenerate this file before changing surrounding code.
- Keep server-only logic in `src/lib/server/**` and have routes consume `event.locals` populated in `src/hooks.server.ts` instead of duplicating session lookup logic inside each route.
- For unit tests, prefer `bun run test:unit -- --run ...` over bare `bun run test:unit`; the bare script starts Vitest in watch mode.
- When running a single Vitest test, include `--project client`, `--project server`, or `--project storybook` so the right environment is selected.
- Playwright e2e depends on the production build path, not the dev server. If an e2e spec fails before the browser opens, inspect `bun run build` and the Cloudflare `preview` path first.
