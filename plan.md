# DuoSync — 雙心同步 Plan.md

> 文體：caveman wenyen (極簡電報文言). 重信號，去虛詞.
> 模式：context-mode 啟. 後端 (M0–M6) 已立; PWA 殼已硬化; UI rebuild (Phase U) 為 next.

---

## 0. 願景 Vision

DuoSync = 二人之私域. 被動共在 (passive presence). 不問「汝在何處」而知之.
核心情感: 親密, 無侵擾, 安心.

---

## 1. 棧定 STACK (Pivot: Full Supabase + RLS, on Cloudflare Workers)

**核**: Supabase 為一切後端 (DB + Auth + Realtime), CF Workers 為 SSR 邊緣.

| 層 | 選 | 理由 |
|---|---|---|
| Auth | **Supabase Auth** (email+pw, Google) | RLS 原生, 無需自托 OAuth client setup 之痛 (Supabase 接 Google), 棄 passkeys |
| ORM | **Drizzle** (postgres-js, supavisor pooler) | 類型查詢仍用 Drizzle; 但敏感讀走 supabase-js 以承 RLS |
| DB | **Supabase Postgres + PostGIS** | 託管, 含 supavisor pooler (Workers 友好), 內建 dashboard |
| **RLS** | **開** | 全表 `auth.uid()` 政策; 客戶端可直查 (謹慎) |
| Runtime | **Cloudflare Workers** (adapter-cloudflare) | 邊緣 SSR; postgres 走 supavisor; 不寫 DO |
| Realtime | **Supabase Realtime** (broadcast + presence + CDC) via `@supabase/realtime-js` | 客戶端直連 wss://*.supabase.co, Worker 不在 WS 路徑上; Phase 9 (DO) 消失 |
| Push | **Web Push (VAPID)** 直發 | W3C 標準, 跨 iOS+Android+desktop, 無 FCM |
| Storage | (defer) | 未實裝; 可後接 Supabase Storage |
| i18n | Paraglide | 已配 |
| UI | DaisyUI + Tailwind 4 | 已配 |

**棄物 (drop list)**:
- `better-auth`, `@better-auth/*` 全部包及其表 (passkey, account, session, verification by-better-auth)
- `src/lib/server/auth.ts` (Better-Auth config)
- `src/routes/auth/sign-in/+page.svelte` 重寫
- `src/lib/server/realtime/in-process.ts` (in-process WS 不適 Workers; Supabase Realtime 替之)
- Vite plugin in-process WS 開發鉤
- `scripts/seed-test-couple.ts` 重寫 (用 Supabase Admin SDK)
- `bun run auth:schema` 命令
- planned DO realtime (Phase 9 整除)

**留物 (keep list)**:
- Drizzle ORM + drizzle-kit (繼續以 postgres-js 對 supavisor)
- `src/lib/server/realtime/adapter.ts` interface (合約留, 換實裝)
- 原 schema 設計 (couple, location_ping, geo_moment, etc.) — 加 RLS 政策; user 表改為 view of `auth.users`
- 所有 PWA / SW / IDB / 安全區內距等客戶端工
- adapter-cloudflare + wrangler.jsonc + nodejs_compat 旗
- Drizzle local docker postgres for dev (亦裝 PostGIS)

---

## 2. 架構 Architecture (Supabase-on-Workers)

```
┌──────────────────────────────────────────────────┐
│  Client: SvelteKit 5 PWA (Svelte runes)          │
│  ├─ supabase-js (browser): auth, realtime, RLS-q │
│  ├─ IDB cache + SW (offline-first)               │
│  └─ UI: DaisyUI + Tailwind 4 + Paraglide i18n    │
├──────────────────────────────────────────────────┤
│  Edge: Cloudflare Workers (adapter-cloudflare)   │
│  ├─ hooks: @supabase/ssr session lookup          │
│  ├─ +page.server.ts: SSR query via Drizzle (su-  │
│  │   pavisor) OR supabase-js admin (服務 key)    │
│  ├─ +server.ts: 變更端點 (validated mutations)   │
│  └─ Push: Web Push send via Worker cron          │
├──────────────────────────────────────────────────┤
│  Supabase (managed):                             │
│  ├─ Postgres + PostGIS (supavisor pooler)        │
│  ├─ Auth: email+pw, Google OAuth                 │
│  ├─ Realtime: broadcast + presence + CDC         │
│  │   wss://<ref>.supabase.co/realtime/v1/...     │
│  └─ RLS: auth.uid() 政策保所有表                  │
└──────────────────────────────────────────────────┘
```

WS 不過 Worker. 客戶端 supabase-js 直連 Supabase Realtime. 故 Worker 無 stateful 連接, 完合 edge.

---

## 3. 數據綱 Schema (Drizzle, postgres dialect, with RLS)

```ts
// auth.users 為 Supabase 管 — 不在我們 Drizzle schema.
// 我們建 public.profile 一對一引 auth.users(id) — 應用層用戶資料.

profile = {
  id: uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  displayName: text NOT NULL,
  avatarEmoji: text DEFAULT '🌱',
  ghostMode: bool DEFAULT false,
  ghostUntil: timestamptz,
  createdAt: timestamptz DEFAULT now()
}
// RLS: SELECT/UPDATE for own row OR partner's row (via couple JOIN).

couple = {
  id, createdAt,
  partnerA: fk(user), partnerB: fk(user),
  nickname?: string, anniversary?: date,
  status: 'pending'|'active'|'paused'|'broken'
}

linkCode = {
  code: 6-char, issuerId: fk(user), expiresAt, usedAt?
}

locationPing = {
  id, userId, coupleId,
  lat: real, lon: real, accuracy: real,
  battery?: real, charging?: bool,
  heading?: real, speed?: real,
  capturedAt: ts, // client time
  receivedAt: ts  // server time
}
// idx (coupleId, userId, capturedAt desc)

place = { id, coupleId, label: 'Home'|'Work'|custom, lat, lon, radius_m }

geoMoment = {
  id, coupleId, authorId, lat, lon, radius_m,
  body: text, mediaUrl?, unlockedAt?, createdAt, expiresAt?
}

message = {
  id, coupleId, authorId, body, type: 'text'|'voice'|'image'|'sticker',
  mediaUrl?, replyToId?, sentAt, deliveredAt?, readAt?, editedAt?
}

moodLog = {
  id, userId, coupleId, emoji, note?, createdAt
}

pushSub = { id, userId, endpoint, p256dh, auth, ua, createdAt }
```

### RLS 政策模板 (per table)

```sql
-- helper: current user's couple_id
create or replace function app.current_couple_id() returns uuid as $$
  select c.id from public.couple c
  where c.partner_a = auth.uid() or c.partner_b = auth.uid()
  limit 1;
$$ language sql stable;

-- example: location_ping
alter table public.location_ping enable row level security;

create policy "read own couple's pings" on public.location_ping
  for select using (couple_id = app.current_couple_id());

create policy "write own pings" on public.location_ping
  for insert with check (user_id = auth.uid() and couple_id = app.current_couple_id());

-- never update or delete pings (immutable log).
```

Pattern repeats for: message, geo_moment, mood_log, place, push_sub. couple itself: select if you're a partner; update only by either partner; delete (unlink) requires both via app logic.

---

## 4. 路徑 Routes

```
/                       → 若已登 → /pulse;  否 → /welcome
/welcome                → marketing/login CTA
/auth/*                 → Better-Auth flows
/onboarding             → name, avatar, mood emoji
/onboarding/link        → generate or enter 6-char code
/pulse                  → ★ 主屏: distance bubble + mood + battery + last-seen
/chat                   → whisper chat
/map                    → shared map (Leaflet/MapLibre)
/moments                → list of geo-moments
/moments/new            → drop note at current loc
/places                 → manage Home/Work/custom
/timeline               → shared memory feed
/settings               → privacy, location-sharing toggles, notifications
/settings/couple        → rename, anniversary, unlink
```

---

## 5. 遷移階段 Migration Phases

### Phase M0 — 預備 Prep (no-credentials work)
- [ ] 此 plan 寫畢
- [ ] Supabase MCP 裝 (待 token)
- [ ] 安裝包: `@supabase/supabase-js`, `@supabase/ssr`; 卸: `better-auth`, `@better-auth/*`, `@simplewebauthn/*`
- [ ] 新文件骨架 (空殼, 可 `bun run check`):
  - `src/lib/server/supabase.ts` — server client factory (per request, with cookies)
  - `src/lib/client/supabase.ts` — browser client (singleton)
  - `src/lib/server/realtime/supabase-channel.ts` — RealtimeAdapter 實裝
- [ ] `.env.example` 更新: `PUBLIC_SUPABASE_URL`, `PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `DATABASE_URL` (supavisor pooler URL)

### Phase M1 — Schema port (waiting on Supabase project)
- [ ] 用戶創 Supabase project, 提供:
  - Project ref
  - anon key
  - service_role key
  - Database URL (supavisor transaction-mode pooler, port 6543)
- [ ] Supabase Dashboard → SQL editor: `create extension postgis;`
- [ ] Drizzle schema 重寫 (drop better-auth tables, add `profile`)
- [ ] `bun run db:generate` → migration SQL
- [ ] Apply via `bun run db:push` OR Supabase MCP `apply_migration`
- [ ] RLS 政策 SQL (一文件, 應用 via MCP)
- [ ] Supabase Dashboard → Auth: 開 email confirmation off (dev) / on (prod), 開 Google provider (用戶提供 GCP credentials)

### Phase M2 — Auth swap
- [ ] `src/hooks.server.ts`: 替換 Better-Auth session lookup 以 `@supabase/ssr` `createServerClient` + `getUser()`
- [ ] `src/app.d.ts`: `locals.user` / `locals.session` 改 Supabase 類型
- [ ] `src/routes/auth/sign-in/+page.svelte`: 重寫 (email+pw + Google btn, 走 supabase.auth.*)
- [ ] `src/routes/auth/sign-up/+page.svelte`: 新建 (or merge into sign-in)
- [ ] `src/routes/auth/callback/+server.ts`: OAuth code exchange
- [ ] `src/routes/auth/sign-out/+server.ts`: 重寫
- [ ] 刪 `src/lib/server/auth.ts` (Better-Auth) 及 `src/lib/server/db/auth.schema.ts`
- [ ] 刪 `bun run auth:schema` script

### Phase M3 — Data layer
- [ ] `src/lib/server/db/index.ts`: postgres-js 對 supavisor URL (與 docker dev 相同 driver, 不同 URL)
- [ ] `locals.couple` 解析: 仍經 Drizzle (服務端 trust)
- [ ] 客戶端讀: 直 supabase-js 對 RLS-保護表 (e.g. live messages query)
- [ ] 變更端點 (mutations): 仍走 +server.ts, 用 Drizzle, 在 transaction 中 `set local "request.jwt.claim.sub" = '<uid>'` so RLS 仍生效

### Phase M4 — Realtime swap
- [ ] `src/lib/server/realtime/supabase-channel.ts`: 實 `RealtimeAdapter` interface
  - 廣播 via DB triggers? OR client-only broadcast channels per couple?
  - 決: 用 broadcast (低延遲) for ephemeral (typing, heartbeat-tap, presence); CDC for persistent (messages)
- [ ] 客戶端 `createRealtimeClient`: 改連 `supabase.channel(\`couple:\${coupleId}\`)`
- [ ] `src/routes/pulse/+page.svelte`: 用新 client (應僅 import 換)
- [ ] 刪 `src/lib/server/realtime/in-process.ts`
- [ ] 刪 Vite plugin (in-process WS server)

### Phase M5 — Cleanup & verify
- [ ] `bun run check` 清
- [ ] `bun run lint` 清
- [ ] 重寫 `scripts/seed-test-couple.ts` 用 supabase admin SDK
- [ ] 重跑 `scripts/test-realtime.ts` 對新 backend
- [ ] `bun run build` 出
- [ ] 手測: signup → login → onboard → pair → /pulse 看 partner

### Phase M6 — RLS hardening pass
- [ ] 每表政策審 (ANON 不應見任何他人數據)
- [ ] 寫 RLS smoke test: 兩用戶 + 越權嘗試 → 期 0 行
- [ ] 文檔: `docs/rls-model.md`

---

## 6. UX 增強提案 — 「passive presence」之延伸

超越 README, 為更佳體驗:

### 情感層
1. **Heartbeat Tap** — 雙擊屏幕送一脈動, partner 設備震動. 無文字之觸.
2. **Mood Weather** — 心情聚合為「今日天氣」(晴/陰/雨), 顯於 pulse 頂部.
3. **Anniversary Ribbon** — 紀念日 + 認識天數 + 下個里程碑倒計 (100天/1年).
4. **Memory Resurface** — 「去年今日」彈出舊照舊訊 (timehop-style).
5. **Mood Streak** — 雙方每日記心情, 連續日數成「同步火焰」.

### 共在層
6. **Co-Listening** — 同步播放 Spotify/YouTube, 進度條共享.
7. **Shared Camera Roll** — drag-drop 自動同步 (R2 + thumbnail).
8. **Today Widget** — iOS/Android home-screen widget (via PWA shortcut).
9. **Sleep Mode** — 雙方均靜止+夜間 → pulse 變柔光「對方安睡中」.
10. **Commute Watch** — 檢測對方通勤中, ETA 估算 (route + speed).

### 安全/信任層
11. **SOS Beacon** — 長按 emoji 發位置+靜音警報, 不依 cell.
12. **Geo-Fence Privacy** — 在某些地點 (eg. 醫院) 自動模糊位置.
13. **Audit Log** — 「誰看了我位置幾次」透明.
14. **Couple Vault** — 共享密碼/note, E2E.

### 互動層
15. **Daily Question** — 每日一題 (如 The And Card), 雙方私答後揭示.
16. **Date Roulette** — 基於雙位置中點建議約會地點.
17. **Sticker Studio** — 用 partner 自拍生成貼紙.
18. **Wishlist Sync** — 共享願望清單, 對方可暗購.

### 性能/可用性
19. **Offline-first** — IndexedDB 緩存最後狀態, 啟動即顯.
20. **Skeleton + Optimistic Everything** — 無 loading spinner.
21. **Haptic Feedback** — 所有交互震動反饋.
22. **Adaptive Battery** — 對方低電 → 自動降本機定位頻率.
23. **Theme Sync** — 雙方主題色聯動 (matching / yin-yang).

---

## 7. 風險 Risks

| 風 | 緩 |
|---|---|
| 持續定位耗電 | 自適應節流; 顯示用戶本機影響 |
| 位置濫用 (stalking) | ghost mode; 解綁即焚數據; 雙確認解綁 |
| Cloudflare Workers CPU 限 | DO 用於熱數據; 重計算移 cron |
| Turso 免費額度 | 老 ping 歸檔 R2 (parquet) |
| iOS Web Push 限制 | 文檔安裝 PWA 流; A2HS prompt |
| 數據隱私法 (GDPR) | 數據導出+刪除 endpoint; 區域選 EU |

---

## 8. 開動條件 Definition of Ready

開工前需:
1. ✅ 用戶確認棧 (徑 A / B)
2. ✅ 確認 UX 增強優先級 (§6 哪些入 MVP)
3. ✅ 域名 + Turso + CF account 就緒
4. ✅ 設計圖/品牌 (顏色, logo) — 或用 placeholder

---

## 9. MVP 切片 (確定)

**MVP = Phase 0-6 + 選定 UX 增強**:
- 核: 配對 → 位置 → 距離 → 聊天 → 推送
- UX 增強 (用戶選):
  1. **Heartbeat Tap** (雙擊震動共脈)
  2. **Offline-first + Skeleton** (IDB 緩存, 無 spinner)
  3. **Ghost Mode + Geo-Fence Privacy** (敏感位置自動模糊)
  4. **Mood Weather** (心情聚合天氣)
  5. **Anniversary Ribbon** (天數/里程碑)
  6. **Memory Resurface** (去年今日)
  7. **SOS Beacon** (長按發位置警報)
  8. **Daily Question** (每日一題)

v1.1+: Co-Listening, Camera Roll, Sleep Mode, Date Roulette, Theme Sync 等.

---

## 10. 即時動作 NOW

**已決**: Full Supabase + RLS, on Cloudflare Workers, Supabase Auth, drop Better-Auth + passkeys.

### Backend / data plane (M-series) — 全完 ALL DONE

- ✅ M0 deps + skeleton
- ✅ M1 schema + RLS (10 policies live, 5 tables, postgis + pgcrypto)
- ✅ M2 auth swap (hooks → Supabase SSR, sign-in form actions, deleted Better-Auth)
- ✅ M3 data layer (postgres-js via Supavisor pooler verified; Drizzle stays on `postgres` superuser = privileged backend = trust boundary at Node layer; RLS protects only direct browser-supabase-js access via anon/authenticated roles)
- ✅ M4 realtime swap (server fetch→Supabase HTTP broadcast; browser supabase-js channels for broadcast + presence; deleted in-process WS adapter + vite-plugin-ws.ts)
- ⏸ M1 Google OAuth (deferred per user)
- ✅ M5/1 scripts rewrite (seed + test-realtime now use Supabase Admin SDK + supabase channels; `ws` + `@types/ws` removed; `auth:schema` script was already gone)
- ✅ M5/2 live smoke test PASSED (9 steps green: presence sync, location_update broadcast, distanceM=283m near-bucket, ghost_change toggle, heartbeat_tap, presence meta update, cleanup). Required clean install (`rm -rf node_modules .svelte-kit && bun install`) to purge stale `@better-auth/*` + `@simplewebauthn/*` from old lockfile state — that was the source of the Vite SSR `getBuiltins` 60s transport timeout AND the mysterious `WARN [Better Auth]` boot log. Both gone now.
- ✅ M6 complete — private channels live, RLS on `realtime.messages`, server-only broadcast, tap endpoint, token refresh, RLS smoke test (all green vs live Supabase: SELECT visibility, 4× WITH CHECK 42501, 2× invisible-UPDATE 0 rows, charlie blocked from couple topic with CHANNEL_ERROR), docs/rls-model.md. `bun run check` + `bun run lint` (M6 files) + `bun run build` clean. Realtime smoke test still 9/9 green against private channels.

### PWA shell hardening (P-series) — 全完 ALL DONE

Out-of-band polish on the PWA shell after M6, prerequisite to U-series UI rebuild (a broken SW lifecycle would compound any UX issue).

- ✅ P1 install-time `skipWaiting()` removed (locked invariant in `src/service-worker.ts`); new SW stays in `installed` until user gesture.
- ✅ P2 activate-time `clients.claim()` removed (locked invariant); page only adopts new SW on user-initiated reload — no surprise reloads mid-interaction.
- ✅ P3 SWR HTML strategy verified end-to-end with headless Playwright (warm tab visits 27–40ms, cold 700–1043ms, `deliveryType="cache"`, `transferSize=0`, `workerStart=49ms`).
- ✅ P4 periodic `setInterval(reg.update, 1h)` removed (browsers auto-check every navigation; the interval just leaked battery).
- ✅ P5 UpdateBanner overlap fix (`3538d8d`): bottom moved from `max(1rem, env(safe-area-inset-bottom))` to `calc(env(safe-area-inset-bottom) + 4.5rem)` so it no longer covers BottomNav tap targets. Verified via manufactured-update Playwright run + `/map` nav click.
- ✅ P6 reload-loop fix (`8b32828`): banner used to come back after click because the 1.5s safety-net fired before the new SW finished activating, reload landed on the OLD SW with the new one still in `installed` → banner reappeared. Now we listen for `worker.statechange → 'activated'` (since `controllerchange` does NOT fire from `skipWaiting()` alone without `clients.claim()` — the reload IS the handoff) and only then reload. Long-tail safety-net bumped to 10s. Verified end-to-end with browser console showing `installed → activating → activated → reload (1129ms post click)`.

PWA shell now bulletproof: no auto-reloads, no banner-overlap, no reload-loop, SWR caching working. Safe to layer the UI redesign on top.

---

### Open M-series follow-ups (small, deferable)

- ⏸ Google OAuth provider (M1) — gated on user providing GCP client credentials.
- 📝 Document the "first paint may be one deploy stale" SWR trade-off in user-facing docs (plan §11 is the right place once the design system covers a "what's new" surface).

---

### M6 detailed plan (post-critique)

**Trust model upgrade**: not just outsider-block. Also **prevent partner-spoofing of server events**. Today client `channel.send` uses the same broadcast channel as server `location_update`/`ghost_change`, so under naive "members can INSERT broadcast" RLS, Bob could forge a fake location for Alice. Fix: server-events become **server-INSERT-only** broadcast; ephemeral client events (heartbeat_tap) move to a **server endpoint** that validates + REST-broadcasts. `typing` is unused dead code → delete.

Concrete steps:
1. **Seed**: add `charlie@duosync.test` (lone, has profile, no couple). Also seed one `location_daily_summary` row + clear stale `link_code` rows for positive/negative controls.
2. **`POST /api/realtime/tap`**: new endpoint. Validates `locals.user`+`locals.couple`, REST-broadcasts `heartbeat_tap`. Replaces direct client `channel.send`.
3. **Client `realtime.svelte.ts`**:
   - `private: true`
   - `start()` → async; `await getSession()` → `await realtime.setAuth(token)` → channel + subscribe
   - `auth.onAuthStateChange` → on `TOKEN_REFRESHED`/`SIGNED_IN` re-call `setAuth`; on `SIGNED_OUT` stop
   - `stop()` cleans up the auth subscription
   - drop `setTyping` + `sendBroadcast` paths; `sendHeartbeatTap()` → `fetch('/api/realtime/tap', {method:'POST'})`
4. **Server `realtime.ts`**: REST broadcast payload `private: true` (was `false`).
5. **Migration `0003_realtime_rls.sql`**:
   - SELECT broadcast for couple members on `couple:<id>` (use `(select realtime.topic()) = 'couple:' || c.id::text`, no UUID casts; filter by `extension in ('broadcast','presence')`)
   - SELECT presence + INSERT presence for couple members
   - **NO** client INSERT broadcast (server REST + service_role bypasses RLS, so server fan-out unaffected)
6. **`scripts/test-rls.ts`**: 3 clients (anon/charlie/alice). Per table, assert select-row counts. Negative writes split by class:
   - Invisible-row UPDATE → expect 0 affected rows
   - WITH CHECK violation INSERT → expect explicit error code (42501 / PostgREST `code: '42501'`)
   - Plus: charlie subscribes to `couple:<alice_bob_id>` with `private:true` → expect `CHANNEL_ERROR`
7. **Update `scripts/test-realtime.ts`**: heartbeat_tap step → POST `/api/realtime/tap` (not `channel.send`); both clients call `realtime.setAuth` (already in place from M5).
8. **`docs/rls-model.md`**: trust boundary, per-table policy, realtime model + spoofing-defense rationale, deploy ordering note (RLS migration first, then client+server flip together), unpair caveat (existing connections survive until reconnect).
9. **Verify**: seed → test-rls → test-realtime; check + lint + build.

Commits (one per logical unit):
- `feat(seed): add charlie + daily summary fixture for RLS tests`
- `feat(rls): RLS smoke test script`
- `feat(realtime): server-owned broadcast topic + tap endpoint` (server changes)
- `feat(realtime)!: private channels + token refresh + drop client broadcast` (client changes)
- `feat(rls): realtime.messages policies, deny client broadcast` (migration)
- `docs: rls-model.md`

**Trust model 註**: Drizzle (server) bypasses RLS — that is correct. Mutations validate `userId === locals.user.id` in services. RLS is the second line for any future direct-from-browser supabase-js queries (which we will add in M4 for realtime CDC reads).

**Note on CF artifacts**: 留 `adapter-cloudflare` + `wrangler.jsonc` (host stays Workers); 棄 in-process WS plugin + DO planning + Better-Auth shims.

---

## 11. UI Implementation Plan — DuoSync Design System Port

> 源: `docs/ui-design/ui-gemini.md` + Gemini mockups (mood board, 4-screen flow, token sheet, component sheet).
> 策略: **rebuild from scratch into new layout**. 舊 svelte 文件留作邏輯參考, 新文件按設計重寫. Server logic (`+page.server.ts`) 多數可保留或微調.

### 11.0 決定 Decisions (locked)

| 項 | 決 |
|---|---|
| 棟略 Build strategy | Rebuild screens from scratch into new layout |
| Map 庫 | **Leaflet** + cozy raster tiles (Stadia AlidadeSmooth light / AlidadeSmoothDark dark, OR CartoDB Positron + DarkMatter); 原因: 用戶要 minimalist 2D + cozy, 無需 vector/3D, ~40KB JS, SSR-safe (lazy-load on mount only) |
| Headless primitives | **bits-ui** (bottom sheet, slider, dialog, tabs, etc.) |
| Icon | **@phosphor-icons/svelte** with `weight="duotone"` (匹配 brief 之 two-tone outline) |
| 字 Fonts | **Google Fonts CDN** — `Inter` (UI) + `Fraunces` (display numerals); preconnect + display=swap |
| 暗 Theme switching | DaisyUI 5 `data-theme="duosync-light"` / `duosync-dark`; per-route override via `<svelte:head>`; `prefers-color-scheme` default; user toggle in /settings |

### 11.1 設計令牌 Design Tokens (U1) — Tailwind v4 + DaisyUI 5 themes

Edit `src/routes/layout.css`:
- 在 `@plugin 'daisyui';` 後加 `@plugin 'daisyui/theme' { name: 'duosync-light'; default: true; ... }` 與 `duosync-dark` (DaisyUI 5 syntax).
- Tokens (per brief):
  - **light**: `--color-base-100: #faf6f1` (cream), `--color-base-200: #ffffff` (paper), `--color-primary: #e07a8f` (dusty rose), `--color-secondary: #9bb89f` (sage), `--color-accent: #f4c97a` (warm gold for "same place"), `--color-error: #c44545` (muted red), `--color-info: #8fa9b8` (mist blue, for "far"), `--color-base-content: #2a2520` (warm ink)
  - **dark**: `--color-base-100: #0e1424` (midnight), `--color-base-200: #1b2238` (slate), `--color-primary: #f4b1a0` (warm peach), `--color-secondary: #8fa9b8` (mist blue), `--color-accent: #f4c97a`, `--color-error: #e88a8a`, `--color-base-content: #e8e2d8`
- 加 `--font-display: 'Fraunces', serif;`, `--font-sans: 'Inter', system-ui, sans-serif;`
- 加 `--radius-bubble: 9999px;`, `--radius-card: 1.25rem;`, `--shadow-paper: 0 1px 2px rgb(0 0 0 / 0.04), 0 8px 24px -8px rgb(120 80 60 / 0.08);`
- 加 distance-bucket color CSS vars: `--distance-same`, `--distance-near`, `--distance-city`, `--distance-far`, `--distance-ghost` (for Distance Bubble ring color via JS state).

### 11.2 字型 Typography (U2)

`src/app.html` (or `src/routes/+layout.svelte`):
```html
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&family=Fraunces:opsz,wght@9..144,400;9..144,600&display=swap" rel="stylesheet">
```
類別:
- `.text-display` → `font-family: var(--font-display); font-feature-settings: 'ss01';` for big numerals (距離, 天數)
- 全域預設 `font-sans`

### 11.3 圖示 Iconography (U3)

- 安裝: `bun add @phosphor-icons/svelte`
- 包裝 `src/lib/components/ui/Icon.svelte` — props: `{ name, size = 24, weight = 'duotone', class }`. Re-exports phosphor icon by name for tree-shaking-friendly per-icon import inside.
- 使用模板 (per brief): heart, map-pin, book-open (timeline), gear (settings), users (couple), navigation-arrow, sparkle (drop moment), ghost, sun/cloud/cloud-rain/moon (mood weather), waveform (heartbeat).

### 11.4 動 Motion primitives (U4)

新檔 `src/lib/motion/`:
- `breathing.ts` — `@keyframes breathe { 0%,100% { transform: scale(1); opacity: .85 } 50% { transform: scale(1.04); opacity: 1 } }` (4s ease-in-out infinite). Disabled under `@media (prefers-reduced-motion)`.
- `ripple.svelte.ts` — heartbeat double-tap detection + expanding ring spawn (returns Svelte 5 runes `$state` of active ripples).
- `vibrate.ts` — `vibrate(pattern: number[]) { if ('vibrate' in navigator) navigator.vibrate(pattern); }`. Default tap pattern `[30, 80, 30]`.
- `presenceDot.css` — pulsing 2s cycle on partner avatar.
- 全 motion 必尊 `prefers-reduced-motion` (已在 layout.css 全域 reset, 但個別組件 prefer texture/color shift over motion as fallback).

### 11.5 組件庫 Component library (U5)

新建 `src/lib/components/ui/` 與 `src/lib/components/duosync/`:

**ui/ (primitive wrappers around bits-ui)**:
- `BottomSheet.svelte` (bits-ui Dialog + drag-to-dismiss)
- `Slider.svelte` (bits-ui Slider, custom ring-renderer for radius)
- `Sheet.svelte`, `Tabs.svelte`, `Toggle.svelte`
- `Icon.svelte` (§11.3)

**duosync/ (domain components, rebuild from old in `src/lib/components/`)**:
- `DistanceBubble.svelte` ★ — large breathing ring, color by bucket prop (`same|near|city|far|ghost`), Fraunces numeral inside, `prefers-reduced-motion` → static ring + bucket label
- `HeartbeatZone.svelte` — full-width invisible bottom strip, double-tap → ripple + vibrate + emit `tap` event
- `MoodWeather.svelte` — emoji + localized caption (晴/陰/雨/夜)
- `AnniversaryRibbon.svelte` (rebuild from old) — top thin ribbon: `Day 423 · 倒數 12 天到一年`
- `MemoryResurface.svelte` (rebuild) — card with blurred old thumbnail + "去年今日"
- `MomentCard.svelte` — locked / unlocked variants. Locked: `filter: blur(8px) saturate(.6)` on body + overlay "Walk closer to read 🚶 87m away"
- `PartnerAvatar.svelte` — emoji/img + presence dot (online/away/ghost) + battery ring
- `GhostBanner.svelte` — banner shown when self ghost mode active, with countdown
- `BottomNav.svelte` (rebuild) — 4 tabs (Pulse / Map / Moments / Settings) with breathing-path active indicator, Phosphor icons, safe-area-bottom padded
- `MapPin.svelte`, `MapDistanceCurve.svelte` — Leaflet-overlay components for Map screen

### 11.6 屏 Screens (U6) — rebuild order

| # | 路徑 | 主題 | 關鍵組件 | 備 |
|---|---|---|---|---|
| 1 | `/onboarding` | light | `<MoodPicker>`, `<AvatarPicker>` | name + emoji + mood; 完成 bloom animation |
| 2 | `/onboarding/link` | light | 6-char `<LinkCode>` 顯示 / 輸入, copy/share | celebrating bloom on success |
| 3 | `/pulse` ★ | light | Anniversary ribbon → Distance Bubble (大) → PartnerAvatar w/ presence+battery → MoodWeather → bottom HeartbeatZone | 主屏, 啟動默認 |
| 4 | `/map` (新) | dark | Leaflet 全屏 + 兩 MapPin (脈動) + 距離 curved connector + "center on us" FAB + bottom-sheet (layer toggles, Home/Work pins) | 唯一 dark-default 屏 |
| 5 | `/moments` | light | 垂直 timeline of `<MomentCard>` (locked/unlocked), year/month scrubber 右側, FAB "+" | 解鎖 logic = `distanceM < radius_m` |
| 6 | `/moments/new` | dark | 頂部 mini-map preview + draggable pin + radius `<Slider>` (30/100/500m visual ring) + caption textarea + image picker + expiry chips + 「Drop here ✨」primary button | 與 map 共享 dark theme |
| 7 | `/settings` | light | sections: profile, ghost mode toggle + duration, notifications, theme, couple settings, sign out | bits-ui Switch + Tabs |
| 8 | `/daily` | light | DailyQuestion card (per §6 #15 — 可推遲) | 若 §9 MVP slice 含則做 |

`+layout.svelte` 改: 全寬, no chrome, BottomNav 固底 (safe-area-bottom). Per-route theme via `<svelte:head><script>document.documentElement.dataset.theme = 'duosync-dark'</script></svelte:head>` (or onMount).

### 11.7 國際化 i18n (U7)

- `messages/zh-cn.json` 已存在 → 補新 keys; 另加 `messages/zh-hant.json` (Traditional, brief 主推 雙心同步/距離/被動共在).
- 全新 UI 字串列入 keys (no hardcoded text in components):
  - `pulse.distance.same`, `pulse.distance.near`, `pulse.distance.city`, `pulse.distance.far`, `pulse.distance.ghost`
  - `pulse.anniversary.day_n`, `pulse.anniversary.next_milestone`
  - `mood.sunny`, `mood.cloudy`, `mood.rainy`, `mood.night`
  - `moments.locked.cta` ("再走近 {distance} 即可閱讀 🚶")
  - `moments.new.drop_here`, `moments.new.radius_m`
  - `nav.pulse`, `nav.map`, `nav.moments`, `nav.settings`
  - `ghost.banner` ("已隱身 · 剩 {minutes} 分")
  - `link.copy`, `link.share`, `link.paired_celebration`
- 文 expansion check: 中文鍵 ≤ 12 chars in nav/buttons.

### 11.8 風險 Risks (UI-specific)

| 風 | 緩 |
|---|---|
| Google Fonts CDN 失/慢 → FOIT | `display=swap` (already), `font-display: optional` for Fraunces (numerals tolerable as fallback) |
| Leaflet SSR (window undefined) | `onMount(() => import('leaflet'))`; `<div bind:this={el}>` only; no `+page.server.ts` map render |
| Phosphor 全 import → bundle 爆 | per-icon import: `import HeartIcon from 'phosphor-svelte/lib/Heart'` (vs barrel) |
| bits-ui 學習曲線 | 先做最小組件 (Slider, Dialog), 漸增; component sheet 是 north star |
| Distance Bubble breathing 在 low-end → jank | use `transform` only (composited), ≤4s cycle, opt-out via `prefers-reduced-motion` |
| Map tiles 對 cozy vibe 不夠柔 | 試 3 tile sources, 選最暖: Stadia Alidade Smooth, CartoDB Voyager, MapTiler Pastel |
| Theme flash on route change (light→dark on /map) | use `<svelte:head>` set theme **before** body paint; consider `<html data-theme>` toggle in beforeNavigate |
| 已存在組件 (DistanceBubble, BottomNav...) 重寫沖突 | 新文件入 `src/lib/components/duosync/`, 舊保留至全部頁面切完 → 一次刪除 commit |

### 11.9 階段 Phases (U-series)

| 階 | 範圍 | 觸發後 commit |
|---|---|---|
| **U1** | Design tokens (layout.css themes) + theme switcher util | `feat(ui): duosync-light/dark daisyui themes` |
| **U2** | Fonts (Inter + Fraunces) + type ramp utilities | `feat(ui): inter + fraunces typography` |
| **U3** | Icon wrapper + phosphor install | `feat(ui): phosphor duotone icon system` |
| **U4** | Motion primitives (breathing, ripple, vibrate, presence) | `feat(ui): motion primitives (breathe/ripple/vibrate)` |
| **U5a** | bits-ui install + ui/ primitives (BottomSheet, Slider, Tabs, Toggle, Sheet) | `feat(ui): bits-ui primitive wrappers` |
| **U5b** | duosync/ domain components (DistanceBubble, HeartbeatZone, MoodWeather, MomentCard, PartnerAvatar, GhostBanner, BottomNav, AnniversaryRibbon, MemoryResurface) | one commit per 2-3 components: `feat(ui): distance bubble + heartbeat zone`, etc. |
| **U6a** | `/pulse` rebuild | `feat(pulse): rebuild per design brief` |
| **U6b** | `/map` rebuild (new route) + Leaflet + tiles | `feat(map): leaflet shared map screen` |
| **U6c** | `/moments` list rebuild + locked-card unlock logic | `feat(moments): timeline + locked cards` |
| **U6d** | `/moments/new` composer rebuild | `feat(moments): geo-moment composer` |
| **U6e** | `/onboarding` + `/onboarding/link` rebuild + bloom animation | `feat(onboarding): paired-bloom celebration` |
| **U6f** | `/settings` rebuild | `feat(settings): theme + ghost + notifications` |
| **U6g** | `+layout.svelte` chrome (BottomNav fixed, safe-area) + per-route theme switching | `feat(layout): bottom nav + per-route theme` |
| **U7** | zh-Hant locale + extracted strings | `feat(i18n): zh-hant + ui copy keys` |
| **U8** | Cleanup — delete legacy `src/lib/components/*.svelte` (old DistanceBubble/BottomNav/etc.) once unreferenced | `chore(ui): drop pre-redesign components` |
| **U9** | Visual QA: snapshot stories in Storybook for each new component; update Playwright e2e to new selectors | `test(ui): storybook + e2e baseline` |

### 11.10 驗 Verify (after each phase)

- `bun run check` — type clean
- `bun run lint` — clean
- `bun run build` — Workers bundle size delta < 100KB (excluding fonts via CDN)
- Manual: dev server, switch themes, throttle network, prefers-reduced-motion ON, mobile viewport (390×844 + 360×640).
- Lighthouse PWA ≥ 90 on /pulse and /map.

### 11.11 開放問 Open questions

1. **Daily Question** (`/daily`) — 是否入 §11 範圍 or 推遲? (per §9 MVP it's listed)
2. **Pull-to-refresh** on /pulse — 加 or 不加? (PWA standalone 模式無 native PTR)
3. **Mood input UI** — single emoji picker vs slider vs preset 4-weather? Brief 暗示 preset 4.
4. **Memory Resurface 觸發** — daily on /pulse top? or notification only?
5. **Ghost Mode duration presets** — 15m / 1h / until-toggled? brief 不明.

(Defer answering until U6 phase begins.)

