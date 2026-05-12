# Bundle audit — DuoSync client JS

Snapshot of the production build's chunk graph and which routes pay
for which dependency. Used as the rationale behind `.size-limit.json`
budgets.

## Top chunks (illustrative — hashes change per build)

| chunk     | size    | content                                   |
| --------- | ------- | ----------------------------------------- |
| supabase  | ~220 KB | `@supabase/supabase-js` + `@supabase/ssr` |
| leaflet   | ~150 KB | `leaflet`                                 |
| ui-glue   | ~50 KB  | shared component glue (phosphor + svelte) |
| sk-start  | ~33 KB  | SvelteKit start + load_css                |
| svelte-rt | ~33 KB  | Svelte 5 runtime                          |

Hashes (e.g. `Cr1MznA9.js`) are content-addressed and rotate every
build — don't pin docs to specific filenames. Re-derive with the
audit script below.

Gzipped, the entire `chunks/*.js` set is **~180 KB** — well under
the 220 KB budget.

## Critical-path verification (welcome + sign-in)

The two routes a logged-out user sees (`/welcome` and `/auth/sign-in`)
are **already off the supabase + leaflet payloads** by architecture:

- node 18 (`/welcome`) → ~2 KB gz
- node 4 (`/auth/sign-in`) → ~2 KB gz

Neither imports the supabase nor leaflet chunks. This is because:

1. `@supabase/supabase-js` is only consumed via
   `src/lib/client/realtime.svelte.ts` and `src/lib/client/supabase.ts`,
   both imported only by `/pulse` and `/moments` route components
   (post-auth surfaces).
2. `leaflet` is only imported by `/map` (post-auth).
3. Auth flows on `/auth/sign-in` use SvelteKit form actions that hit
   `src/lib/server/supabase.ts` server-side; the browser bundle is
   not pulled in.

## Budgets

The four hard caps in `.size-limit.json` lock the above:

- `welcome route node (node 18)` ≤ 8 KB gz
- `auth/sign-in route node (node 4)` ≤ 8 KB gz
- `root layout node (node 0)` ≤ 30 KB gz
- `client chunks total` ≤ 220 KB gz

If anyone accidentally adds a `getSupabaseClient()` call to the root
layout or the welcome page component, the per-node budget will fail
in CI before the regression ships.

## Re-running the audit

```bash
bun run build && bun run size
```

To inspect a node-to-route mapping after a build:

```bash
ls .svelte-kit/generated/client-optimized/nodes/  # 0.js, 1.js, ...
cat .svelte-kit/generated/client-optimized/nodes/<id>.js  # exports component path
```
