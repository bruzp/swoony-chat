# Swoony v1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans (default) or superpowers:subagent-driven-development (only if the owner chooses it) to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. The human run sheet is `docs/execution.md`: **stop after every task** for the owner's review before committing.

**Goal:** Ship Swoony v1, an anonymous, no-signup, 18+, mobile-first 1-on-1 chat site, on Cloudflare.

**Architecture:** One Cloudflare Worker serves the static site (landing, terms, privacy, React chat app) and a small HTTP API. Live state lives in two Durable Object classes using WebSocket hibernation: one global `Lobby` (sessions, presence, online list, blocks, chat routing, abuse counters) placed in APAC, and one `ChatRoom` per user pair (relay plus a short resume buffer that wipes itself). D1 stores only reports and bans, keyed by HMAC hashes; KV caches active bans.

**Tech Stack:** TypeScript (strict), Vite + `@cloudflare/vite-plugin`, Wrangler (`wrangler.jsonc`), React 19, Tailwind CSS v4, shadcn/ui (Radix), Zustand, zod v4, `obscenity`, `@tanstack/react-virtual`, `@marsidev/react-turnstile`, `@fontsource-variable/plus-jakarta-sans`, Vitest 4 with `@cloudflare/vitest-plugin` (worker) and jsdom + Testing Library (web), ESLint (typescript-eslint strict-type-checked) + Prettier.

**Spec:** `CLAUDE.md` (all product decisions).

## Global Constraints

- **No accounts.** Entry is nickname + gender + age + country (+ optional bio) + 18+ confirmation.
- **Ephemeral for users, retained for the law (RA 11930, Task 0 decision B).** Live chat text lives only in the ChatRoom (deleted 10 min after the chat ends, never later than 24 h); profiles vanish on leave. The `RetentionStore` (D1, AES-GCM encrypted payloads) keeps connection records (nickname, IP, country, device hash, session times) and chat records (who chatted with whom, when) for 6 months, and message snapshots of **reported** chats for 1 year. `RETAIN_ALL_CONTENT` (`true` since 2026-11-21, decision) also archives every message for 1 year: the ChatRoom batches messages in `archive_pending` and flushes 100 at a time (and at chat end, before any wipe) to `ContentArchive`, which writes gzip + AES-GCM bundles to R2 (`ARCHIVE`, bucket `swoony-archive`) with one `content_archive` D1 index row each (migration `0007`). Plan: [superpowers/plans/2026-11-20-keep-all-messages.md](superpowers/plans/2026-11-20-keep-all-messages.md). Reports/bans (hashed) kept 6 months. Rows under a legal hold are not purged.
- **18+ confirmation** required (`confirmedAdult: true`); no real age verification.
- **No avatars or images.** Letter tiles only. **No sound.** Visual alerts only. **1-on-1 only.**
- **Nickname:** 3–20 chars, `^[A-Za-z0-9_]+$`, unique among online users case-insensitively, profanity filtered.
- **Gender:** `male | female | other`. **Age:** 18–99. **Country:** ISO 3166-1 alpha-2, pre-selected from `request.cf.country`.
- **Bio:** optional, max 150 chars, link + profanity filtered.
- **Message:** max 1,000 code points, NFKC-normalised for checks; links, contact details and profanity/sexual terms blocked.
- **Contact details:** phone numbers (7+ digits, incl. spaced or spelled out), emails (incl. "at … dot" disguises) and social handles / "add me on ig"-style phrases are blocked in nicknames, bios and messages (child-safety measure under RA 11930 Sec. 9(a)(6): keeps chats from moving off-platform).
- **Profanity:** one English filter (`obscenity` English dataset + `EXTRA_SEXUAL_TERMS`: swear words such as "fuck", sexual terms such as "pussy"/"dick"/"nudes"/"horny", slurs, with leetspeak and spacing tricks) for nicknames, bios and messages. **No non-English (e.g. Filipino) terms.**
- **Network key:** IPv4 = the full address; IPv6 = its /64 prefix.
- **Rate limits (`shared/config.ts`):** 5 msgs / 5 s per chat; 10 new chats / min; same text (10+ chars, so short greetings like "hi" are exempt) to 5+ users / min = spam; entries 5 / 10 min per device and 30 / 10 min per network (the network count only includes entries that pass Turnstile, so bots can't lock out a shared IP); 10 reports / hour per device; 20 lobby messages / 10 s per socket; max 5 sockets per user in the lobby and in each chat (a 6th closes the oldest, close code 4003); 10 chat history requests / 10 s per user; 20 typing/seen signals / 10 s per user (extra ones dropped, no strike); frames > 4 KB dropped unparsed. Edge flood limit: a Cloudflare WAF rule, 100 `/api/` requests / 10 s per IP ([deployment.md](deployment.md) step 8).
- **Strikes:** rate-limit and spam hits are strikes, and so is every 3rd `contact` rejection within 10 min (`LIMITS.contactRejectionsForStrike`); other moderation rejections (links, profanity) are not. Strike → "slow down" notice; 3 strikes / 10 min → kicked; 3 kicks / 24 h → ban.
- **Reports:** reasons `spam | harassment | underage | sexual | other`, equal weight. A report **counts** only if the reporter had a chat with the target this session in which the target sent ≥ 1 message. 3 counted reports within 24 h from **3 different devices and 3 different networks** → ban. Device ban ladder 1 h → 24 h → 7 days (prior bans of that device in 30 days); network ban always 1 h. Reporting also blocks. Uncounted reports still answer `reported` (eligibility is never revealed).
- **Block:** session-scoped, keyed by the blocked `userId` (accepted trade-off: re-entry gets a new id).
- **One session per device:** signed HttpOnly cookie `sw_dev`; every tab is the same user.
- **Leave grace:** 60 s after the last socket closes. **Idle:** kicked after 30 min.
- **Bot protection:** Turnstile on entry only, verified server-side incl. hostname + action in production.
- **Chat end:** leave or block → the other user sees "X left".
- **Theme:** follows `prefers-color-scheme` live; manual override in `localStorage` key `swoony-theme`.
- **Look:** Berry gradient `#DB2777 → #7C3AED` only on primary buttons, own bubbles, badges, logo. Tap targets ≥ 44 px. Plus Jakarta Sans, self-hosted (no Google Fonts).
- **Ads:** `<AdSlot>` at `list-inline` and `chat-empty` (empty chat area on desktop); renders nothing while `ADS_ENABLED` is false (accepted: layout shifts slightly when ads go on). No ad on the chat screen or beside an open chat (the details pane): AdSense forbids ads on private-chat screens (decision, L11; replaces the 2026-11-19 details-pane ad position).
- **Personal data:** reports, bans and KV keys use `HMAC-SHA256(IDENTITY_HASH_SECRET, value)` for device ids and network keys. Raw identifiers investigators need (IP, nickname) exist only in the Lobby during the session and inside encrypted `RetentionStore` payloads (key `RETENTION_KEY`; never logged or sent to clients). Only the owner's admin endpoints (Task 9B) decrypt them.
- **Legal duties (RA 11930 Sec. 9):** Terms prohibit OSAEC/CSAEM; owner can act on a takedown notice within 24 h and report to the DOJ within 3 days (Task 9B runbook); abuse contact `abuse@swoony.chat`; NPC registration and lawyer sign-off before launch (Task 15).
- **Log policy:** never log message text, bios, nicknames, IPs, device ids, cookies or tokens. Log event names, error codes and hashed ids only.
- **Placement:** Lobby DO created with `locationHint: "apac"`.
- **Country availability (decided in Task 0):** `BLOCKED_COUNTRIES = ["GB", "AU", "ID"]` in `shared/config.ts`; requests whose `request.cf.country` is listed get `451 {error:"region_unavailable"}` on `/api/*` and the static page `/unavailable/`.
- **Analytics:** Cloudflare Web Analytics only. **Environments:** local and production.
- **Code style:** self-documenting names; no explanatory comments; no `any`, `@ts-ignore`, or eslint-disable.
- **Tests:** every test sketched with `/* ... */` must be written in full before implementing. Worker tests run with `--max-workers=1 --no-isolate` (WebSocket Durable Objects need shared storage), so every test calls `resetLobby()` in `beforeEach` and uses unique nicknames/networks from the helpers.
- **Commits:** Conventional Commits per `CLAUDE.md` → "Git conventions". No AI attribution trailers.
- **Docs before memory:** verify Cloudflare APIs with the `cloudflare-docs` MCP and library APIs with Context7 before writing setup code.

## Review Focus

1. **Phone locks or network drops mid-chat:** reconnect within 60 s keeps identity, chats and unseen messages, no duplicates. Tests: Task 7 `keeps user through a reconnect inside grace`, Task 8 `resume returns only messages after afterSeq`, Task 8 `hello lists open chats`.
2. **Two tabs on one device:** one user; both tabs get messages; closing one tab keeps the session. Tests: Task 5 `second tab resumes the same user`, Task 7 `closing one of two sockets keeps the user online`.
3. **Cross-site requests:** WebSocket upgrades and `POST /api/session` with a foreign `Origin` are rejected. Tests: Task 5 `rejects lobby upgrade from foreign origin`, `rejects entry from foreign origin`.
4. **Spoofed identity / stale access:** client-sent `X-Swoony-*` headers are ignored; ended or blocked chats can't be rejoined. Tests: Task 8 `ignores client-supplied identity header`, `blocked user cannot reconnect to the chat`.
5. **Report brigading:** one person with several browsers can't ban someone. Tests: Task 9 `reports from one network count once`, `report without a two-way chat does not count`.

---

## File Structure

```
swoony/
  wrangler.jsonc  vite.config.ts  vitest.worker.config.ts  vitest.web.config.ts
  eslint.config.js .prettierrc .gitignore .gitattributes tsconfig*.json components.json .dev.vars.example
  .github/workflows/ci.yml
  migrations/0001_init.sql            D1: reports, bans (hashed ids)
  migrations/0004_admin_audit.sql     admin activity log (hash chain), admin Task A3
  migrations/0005_job_runs.sql        cleanup job history and alert throttle, admin Task A7
  migrations/0006_chat_and_hold_indexes.sql  indexes: chat_log by chat id, legal holds (review 2026-11-20)
  docs/legal/research.md              Task 0
  docs/legal/runbook.md               Task 9B (owner steps for legal requests)
  index.html  terms/index.html  privacy/index.html  safety/index.html  faq/index.html  unavailable/index.html  404.html  chat/index.html
  s-admin/index.html                  admin page entry (served by the Worker after the Access check)
  public/_headers  public/robots.txt  public/sitemap.xml
  scripts/loadtest.ts                 Task 15
  scripts/legal/*.ts                  Task 9B owner CLI (lookup, ban, takedown, hold), backup to the admin page
  shared/
    config.ts profile.ts countries.ts
    text/links.ts text/profanity.ts text/moderateText.ts
    protocol/api.ts protocol/lobby.ts protocol/chat.ts protocol/admin.ts
    legal/records.ts legal/csv.ts legal/canonical.ts legal/time.ts   shared by the Worker, admin page and CLI
  worker/
    index.ts app.ts deps.ts
    http/deviceCookie.ts http/requestInfo.ts
    botcheck/BotCheck.ts botcheck/TurnstileBotCheck.ts
    moderation/identityHash.ts moderation/banStore.ts moderation/reportStore.ts moderation/retention.ts
    retention/Encryptor.ts retention/RetentionStore.ts   encrypted legal-retention records
    admin/adminRoutes.ts                                   owner-only legal-request API for the CLI (Task 9B)
    admin/accessAuth.ts adminPage.ts webAdminRoutes.ts     web admin: Access JWT check, page, /api/s-admin (admin-plan.md)
    admin/actions.ts auditLog.ts auditRecorder.ts adminHeaders.ts export/*   shared actions, activity log, headers, CSV/PDF
    health/healthChecks.ts cleanup.ts jobRuns.ts alerts.ts                     /api/health, tracked daily cleanup, email alerts
    support/rateLimit.ts support/hash.ts
    lobby/Lobby.ts lobby/userTable.ts lobby/listing.ts lobby/abuse.ts lobby/maintenanceStore.ts
    chat/ChatRoom.ts chat/chatId.ts
    test/helpers.ts
  src/
    app/main.tsx app/App.tsx app/store.ts
    lib/ReconnectingSocket.ts lib/api.ts lib/theme.ts lib/viewport.ts lib/cn.ts
    components/AdSlot.tsx LetterTile.tsx ThemeToggle.tsx AppShell.tsx detailsPane.ts LiveAnnouncer.tsx ui/*
    features/entry/EntryScreen.tsx TurnstileField.tsx
    features/lobby/useLobbyConnection.ts OnlineList.tsx FilterBar.tsx ProfileDialog.tsx ReportDialog.tsx
    features/chat/useChatConnection.ts ChatScreen.tsx ChatsList.tsx MessageList.tsx Composer.tsx PeerDetails.tsx useUnreadTitle.ts useBackToList.ts
    features/me/MePanel.tsx AccountCard.tsx
    styles/app.css static/static.css
    admin/AdminApp.tsx adminApi.ts pages/*                admin page (separate bundle under /s-admin/assets/)
```

---

### Task 0: Legal and compliance research (no code)

**Files:**
- Create: `docs/legal/research.md`
- Modify: `CLAUDE.md` (record decisions), and `plan.md` Tasks 4/8/9 + `LIMITS` if the data model changes

**Interfaces:**
- Produces: a decisions table later tasks consume: `BLOCKED_COUNTRIES`, retention periods (`LIMITS.connectionRetentionMs`, `reportedContentRetentionMs`, `moderationRetentionMs`), whether reports must keep an evidence snapshot (e.g. last N messages for `underage`/`sexual`, for how long, encrypted), required abuse / law-enforcement contact, required privacy-notice contents, any registration duty.

- [ ] **Step 1: Research primary sources** (official gazette, NPC, DICT/CICC, statute text) and record each claim with a link: PH Data Privacy Act RA 10173 + IRR (NPC registration thresholds, lawful basis, data-subject rights, breach notice); PH Anti-OSAEC and Anti-CSAEM Act RA 11930 (internet-intermediary duties: notice and takedown, reporting to authorities and timeframes, data preservation periods); Singapore PDPA, Malaysia PDPA, Thailand PDPA, Indonesia PDP Law (notice/cross-border basics); access-blocking risk for anonymous 18+ chat in Indonesia/Malaysia. **Western reach:** UK Online Safety Act (Ofcom duties for user-to-user chat, age assurance), Australia Online Safety Act (eSafety codes), EU GDPR (Art. 3(2) territorial scope, EU representative duty) and Digital Services Act (contact point, notice-and-action), US COPPA and federal CSAM reporting (18 U.S.C. 2258A applicability to a non-US provider). Recommend the final `BLOCKED_COUNTRIES` list.
- [ ] **Step 2: Write the decisions table** with a recommendation per item and what it changes in the plan.
- [ ] **Step 3: Stop** and present to the owner. Apply the approved decisions to `CLAUDE.md`, `LIMITS` and Tasks 4/8/9 before Task 4 starts.
- [ ] **Step 4: Commit** `docs(legal): add compliance research and data decisions`

---

### Task 1: Project scaffold, tooling and CI

**Files:**
- Create: `package.json`, `wrangler.jsonc`, `vite.config.ts`, `vitest.worker.config.ts`, `vitest.web.config.ts`, `tsconfig.json`, `tsconfig.app.json`, `tsconfig.worker.json`, `tsconfig.node.json`, `eslint.config.js`, `.prettierrc`, `.gitignore`, `.gitattributes`, `.dev.vars.example`, `.env.development`, `components.json`, `.github/workflows/ci.yml`, `index.html`, `chat/index.html`, `src/app/main.tsx`, `src/app/App.tsx`, `src/styles/app.css`, `src/lib/cn.ts`, `worker/index.ts`, `worker/app.ts`, `worker/deps.ts`
- Test: `worker/app.test.ts`, `src/app/App.test.tsx`

**Interfaces:**
- Produces: `handleRequest(request: Request, env: Env, deps: AppDeps): Promise<Response>`; `AppDeps = { now: () => number }` (extended later); `createDeps(env: Env): AppDeps`; `Env` from `wrangler types` (`worker-configuration.d.ts`, committed); `json(body: unknown, status?: number): Response`; scripts `dev`, `build`, `typecheck`, `lint`, `test`, `test:worker` (`vitest run -c vitest.worker.config.ts --max-workers=1 --no-isolate`), `test:web`, `check` (typecheck + lint + test), `deploy`.

- [ ] **Step 1: Scaffold.** Verify setup with the `cloudflare-docs` MCP ("Vite plugin React tutorial", "vitest-plugin configuration"). Install `react react-dom zustand zod @fontsource-variable/plus-jakarta-sans`; dev: `vite @vitejs/plugin-react @cloudflare/vite-plugin wrangler typescript tailwindcss @tailwindcss/vite vitest@^4.1.0 @cloudflare/vitest-plugin jsdom @testing-library/react @testing-library/user-event @testing-library/jest-dom eslint typescript-eslint eslint-plugin-react-hooks eslint-plugin-react-refresh prettier`.
- [ ] **Step 2: Config.**
  - `wrangler.jsonc`: `name: "swoony"`, `main: "./worker/index.ts"`, `compatibility_date: "2026-11-18"`, `assets: { not_found_handling: "404-page", run_worker_first: ["/api/*"] }`, `observability: { enabled: true }`, `upload_source_maps: true`.
  - `vite.config.ts`: plugins `react()`, `tailwindcss()`, `cloudflare()`; `build.rollupOptions.input` = `index.html`, `chat/index.html`.
  - `vitest.worker.config.ts`: `cloudflareTest({ wrangler: { configPath: "./wrangler.jsonc" }, miniflare: { bindings: { ALLOW_TEST_RESET: "1", COOKIE_SECRETS: "<32+ char test secret>", IDENTITY_HASH_SECRET: "<32+ char test secret>", TURNSTILE_SECRET: "test", RETENTION_KEY: "<base64 of 32 test bytes>", ADMIN_TOKEN: "<32+ char test token>", RETAIN_ALL_CONTENT: "false" } } })`, include `worker/**/*.test.ts`.
  - `vitest.web.config.ts`: `environment: "jsdom"`, include `src/**/*.test.{ts,tsx}`, `shared/**/*.test.ts`, setup imports `@testing-library/jest-dom/vitest`.
  - tsconfig: `strict`, `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`, `verbatimModuleSyntax`; aliases `@/` → `src/`, `@shared/` → `shared/` (mirrored in Vite and both Vitest configs).
  - ESLint: `tseslint.configs.strictTypeChecked`, react-hooks recommended, `no-console` allowing `warn`/`error`.
  - `.gitignore` (one per line): `node_modules/`, `dist/`, `.wrangler/`, `.dev.vars`, `.dev.vars.*`, `!.dev.vars.example`, `.env.local`, `.env.production`, `.env.*.local`, `coverage/`, `*.log`. `worker-configuration.d.ts` is committed.
  - `.gitattributes`: `* text=auto eol=lf`.
  - `.dev.vars.example`: `COOKIE_SECRETS=dev-only-cookie-secret-at-least-32-chars`, `IDENTITY_HASH_SECRET=dev-only-hash-secret-at-least-32-chars`, `TURNSTILE_SECRET=1x0000000000000000000000000000000AA`, `RETENTION_KEY=<dev-only base64 32 bytes>`, `ADMIN_TOKEN=dev-only-admin-token-at-least-32-chars`, plus the admin and alert secrets. Wrangler loads only the names in `secrets.required` from `.dev.vars`, so the dev-only settings (`TURNSTILE_HOSTNAMES=` to skip the hostname/action check, `DEV_INSECURE_COOKIES=1`, `ADMIN_DEV_EMAIL`) are set by `vite-plugins/localDevVars.ts` during `vite dev` only. The localhost admin sign-in needs both `ADMIN_DEV_EMAIL` and `DEV_INSECURE_COOKIES=1`, so one stray variable cannot open it.
  - `.env.development`: `VITE_TURNSTILE_SITE_KEY=1x00000000000000000000AA`.
- [ ] **Step 3: Write failing tests.**

```ts
// worker/app.test.ts
import { env } from "cloudflare:workers";
it("GET /api/health returns ok", async () => {
  const res = await handleRequest(new Request("http://localhost/api/health"), env, { now: () => 0 });
  expect(res.status).toBe(200);
  expect(await res.json()).toEqual({ ok: true });
});
it("unknown /api route returns 404 json", async () => {
  const res = await handleRequest(new Request("http://localhost/api/nope"), env, { now: () => 0 });
  expect(res.status).toBe(404);
  expect(await res.json()).toEqual({ error: "not_found" });
});
```
```tsx
// src/app/App.test.tsx
it("renders the Swoony wordmark", () => { render(<App />); expect(screen.getByText("swoony")).toBeInTheDocument(); });
```
- [ ] **Step 4: Run** `npm run test` → FAIL.
- [ ] **Step 5: Implement** route table (`GET /api/health`, fallback `404 {error:"not_found"}`), `worker/index.ts` default `{ fetch }`, minimal `App`, `chat/index.html` mounting `src/app/main.tsx`, placeholder landing, font imported in `src/styles/app.css`.
- [ ] **Step 6: shadcn.** `npx shadcn@latest init` (Tailwind v4, alias `@/components`), `npx shadcn@latest mcp init --client claude`, add `button input label select checkbox textarea sheet dialog dropdown-menu sonner badge radio-group popover`.
- [ ] **Step 7: CI** `.github/workflows/ci.yml`: on `push` + `pull_request`, Node 22, `npm ci`, `npm run check`.
- [ ] **Step 8: Verify** `npm run check` → PASS; `npm run dev` → `/chat/` shows wordmark; `/api/health` → `{"ok":true}`.
- [ ] **Step 9: Commit** `chore: scaffold vite react worker project with tooling and ci`

---

### Task 2: Shared profile model, config and countries

**Files:**
- Create: `shared/config.ts`, `shared/profile.ts`, `shared/countries.ts`
- Test: `shared/profile.test.ts`, `shared/countries.test.ts`

**Interfaces:**
- Produces:
  - `LIMITS` (below), `REPORT_REASONS = ["spam","harassment","underage","sexual","other"] as const`, `type ReportReason`, `ADS_ENABLED = false`, `BLOCKED_COUNTRIES: readonly string[] = ["GB", "AU", "ID"]`, `isBlockedCountry(code: string | null): boolean` (null → false).
  - `GENDERS = ["male","female","other"] as const`, `type Gender`.
  - `interface Profile { nickname: string; gender: Gender; age: number; country: string; bio: string }`; `type ProfileInput = Omit<Profile, "bio"> & { bio?: string | undefined }`.
  - `interface PublicUser extends Profile { userId: string }`.
  - `interface UserFilter { genders?: Gender[]; minAge?: number; maxAge?: number; countries?: string[] }`.
  - `profileSchema: z.ZodType<Profile, ProfileInput>` (bio defaults to `""`), `userFilterSchema`, `nicknameKey(nickname: string): string`, `matchesFilter(user: Profile, filter: UserFilter): boolean`.
  - `COUNTRY_CODES: readonly string[]`, `isCountryCode(code: string): boolean`, `countryName(code: string, locale?: string): string` (`Intl.DisplayNames`).

```ts
export const LIMITS = {
  nickname: { min: 3, max: 20, pattern: /^[A-Za-z0-9_]+$/ },
  age: { min: 18, max: 99 },
  bioMax: 150,
  messageMax: 1000,
  maxFrameBytes: 4096,
  maxEntryBodyBytes: 4096,
  messagesPerChat: { count: 5, windowMs: 5_000 },
  lobbyMessagesPerSocket: { count: 20, windowMs: 10_000 },
  newChats: { count: 10, windowMs: 60_000 },
  duplicateText: { users: 5, windowMs: 60_000, checkedMessagesPerChat: 3, minChars: 10 },
  entriesPerDevice: { count: 5, windowMs: 600_000 },
  entriesPerNetwork: { count: 30, windowMs: 600_000 },
  reportsPerDevice: { count: 10, windowMs: 3_600_000 },
  strikesForKick: { count: 3, windowMs: 600_000 },
  contactRejectionsForStrike: { count: 3, windowMs: 600_000 },
  kicksForBan: { count: 3, windowMs: 86_400_000 },
  reportsForBan: { distinctReporters: 3, windowMs: 86_400_000 },
  deviceBanLadderMs: [3_600_000, 86_400_000, 604_800_000],
  networkBanMs: 3_600_000,
  banHistoryWindowMs: 2_592_000_000,
  leaveGraceMs: 60_000,
  idleKickMs: 1_800_000,
  presenceBatchMs: 1_500,
  listPageSize: 30,
  chatBufferMax: 200,
  chatOrphanWipeMs: 120_000,
  chatMaxLifetimeMs: 86_400_000,
  socketGiveUpAttempts: 5,
  chatReportWindowMs: 600_000,
  connectionRetentionMs: 15_552_000_000,
  reportedContentRetentionMs: 31_536_000_000,
  moderationRetentionMs: 15_552_000_000,
} as const;
```

- [ ] **Step 1: Write failing tests.**

```ts
const valid = { nickname: "Mika_24", gender: "female", age: 24, country: "PH", bio: "" };
it("accepts a valid profile", () => expect(profileSchema.safeParse(valid).success).toBe(true));
it.each(["ab", "a".repeat(21), "has space", "emoji😀"])("rejects nickname %s", (n) =>
  expect(profileSchema.safeParse({ ...valid, nickname: n }).success).toBe(false));
it("rejects non-ascii nickname", () => expect(profileSchema.safeParse({ ...valid, nickname: "Mіka" }).success).toBe(false));
it.each([17, 100, 24.5])("rejects age %s", (age) => expect(profileSchema.safeParse({ ...valid, age }).success).toBe(false));
it("rejects unknown gender and country", () => {
  expect(profileSchema.safeParse({ ...valid, gender: "x" }).success).toBe(false);
  expect(profileSchema.safeParse({ ...valid, country: "ZZ" }).success).toBe(false);
});
it("rejects bio over 150 chars", () => expect(profileSchema.safeParse({ ...valid, bio: "a".repeat(151) }).success).toBe(false));
it("defaults bio to empty", () => { const { bio: _b, ...rest } = valid; expect(profileSchema.parse(rest).bio).toBe(""); });
it("nicknameKey is case-insensitive", () => expect(nicknameKey("MiKa")).toBe(nicknameKey("mika")));
it("matchesFilter applies gender, age range and countries", () => {
  const p = profileSchema.parse(valid);
  expect(matchesFilter(p, { genders: ["female"], minAge: 20, maxAge: 30, countries: ["PH"] })).toBe(true);
  expect(matchesFilter(p, { genders: ["male"] })).toBe(false);
  expect(matchesFilter(p, { maxAge: 23 })).toBe(false);
  expect(matchesFilter(p, { countries: ["US"] })).toBe(false);
  expect(matchesFilter(p, {})).toBe(true);
});
it("has PH and 240+ codes", () => { expect(isCountryCode("PH")).toBe(true); expect(COUNTRY_CODES.length).toBeGreaterThan(240); });
it("names a country", () => expect(countryName("PH", "en")).toBe("Philippines"));
it("isBlockedCountry", () => { expect(isBlockedCountry("GB")).toBe(true); expect(isBlockedCountry("PH")).toBe(false); expect(isBlockedCountry(null)).toBe(false); });
```
- [ ] **Step 2: Run** `npm run test:web -- shared` → FAIL.
- [ ] **Step 3: Implement** the three files (profanity is applied in Task 3/5, not in the schema).
- [ ] **Step 4: Run** → PASS; `npm run check` → PASS.
- [ ] **Step 5: Commit** `feat(shared): add profile model, limits and country list`

---

### Task 3: Text moderation (links, contact details, profanity, sexual terms)

**Files:**
- Create: `shared/text/normalize.ts`, `shared/text/links.ts`, `shared/text/contact.ts`, `shared/text/profanity.ts`, `shared/text/moderateText.ts`
- Test: `shared/text/links.test.ts`, `shared/text/contact.test.ts`, `shared/text/profanity.test.ts`, `shared/text/moderateText.test.ts`

**Interfaces:**
- Consumes: `LIMITS`.
- Produces:
  - `normalizeForChecks(text: string): string`: NFKC, lower-case, strip zero-width characters, map common look-alikes (`0→o` only inside letter runs, `@`/`(at)`/`[at]`/` at ` handled by the email check, not here).
  - `containsLink(text: string): boolean`
  - `containsPhoneNumber(text: string): boolean`: 7+ digits after removing spaces, dots, dashes, brackets and `+` between digits; also spelled-out digit runs (`zero`, `one` … `nine`, `oh`) of 7+ words in a row.
  - `containsEmail(text: string): boolean`: `local@domain.tld`, plus disguised forms `local at domain dot tld`, `(at)`, `[at]`, `{at}` with `(dot)` variants.
  - `containsSocialHandle(text: string): boolean`: an `@handle` token (3+ word chars, not an email), or a contact-moving phrase: a platform name or abbreviation (`instagram`, `ig`, `insta`, `telegram`, `tg`, `whatsapp`, `wa`, `viber`, `facebook`, `fb`, `messenger`, `snapchat`, `snap`, `sc`, `kik`, `discord`, `line`, `wechat`, `signal`, `tiktok`, `twitter`, `x.com`, `onlyfans`, `of`) **combined** with a handle-like token or a cue word (`add`, `dm`, `pm`, `msg`, `message`, `hmu`, `follow`, `my`, `is`, `id`, `user`, `handle`, `me on`) within 4 words. A platform name alone is allowed.
  - `containsContactDetails(text: string): boolean` = phone ∨ email ∨ social handle.
  - `containsProfanity(text: string): boolean`: `obscenity` `RegExpMatcher` built from `englishDataset` **plus** `EXTRA_SEXUAL_TERMS` (English only, in `profanity.ts`: e.g. `nudes`, `nude`, `horny`, `sexting`, `sex chat`, `cum`, `boobs`, `tits`, `blowjob`, `handjob`, `nsfw`, `fap`, `jerk off`, `69`, `bj`, `milf`, `dtf`, `send pics`, `cam show`) with `englishRecommendedTransformers`. **No non-English terms.**
  - `isCleanNickname(nickname: string): boolean`: no profanity and no contact details.
  - `type ModerationRejection = "empty" | "too_long" | "link" | "contact" | "profanity"`
  - `moderateText(text: string, maxLength: number): { ok: true; text: string } | { ok: false; reason: ModerationRejection }`: trims; checks a `normalizeForChecks` copy in the order empty → too_long → link → contact → profanity; length in code points; returns the original trimmed text when ok.

- [ ] **Step 1: Write failing tests.**

```ts
it.each(["visit http://x.io", "https://a.b", "www.site.net", "go to mysite.com", "mysite dot com", "mysite (dot) com",
  "mysite[.]net", "mysite[dot]org", "SITE.COM", "ｓｉｔｅ．ｃｏｍ"])("detects link: %s", (t) => expect(containsLink(t)).toBe(true));
it.each(["hello there", "I'm 24.5 years", "ok...sure", "e.g. this", "3.14", "lol.", "done. Is it ok?", "ok.so what",
  "I'm in. at home", "me.to", "nice to meet you"])("allows: %s", (t) => expect(containsLink(t)).toBe(false));
it.each(["09171234567", "0917 123 4567", "0917-123-4567", "+63 917 123 4567", "(02) 8123 4567", "zero nine one seven one two three four"])
  ("detects phone: %s", (t) => expect(containsPhoneNumber(t)).toBe(true));
it.each(["I'm 24", "at 10:30 pm", "500 pesos", "born 1999", "top 10 of 2024", "room 1203"])
  ("allows numbers: %s", (t) => expect(containsPhoneNumber(t)).toBe(false));
it.each(["mika@gmail.com", "MIKA.24@Yahoo.co", "mika at gmail dot com", "mika (at) gmail (dot) com", "mika[at]mail[dot]com"])
  ("detects email: %s", (t) => expect(containsEmail(t)).toBe(true));
it.each(["I'm at home", "look at that", "meet at 5"])("allows: %s", (t) => expect(containsEmail(t)).toBe(false));
it.each(["add me on ig", "my telegram is mika24", "whatsapp me", "@mika_24", "hmu on snap", "dm me on insta mika.24", "fb: mika santos"])
  ("detects social: %s", (t) => expect(containsSocialHandle(t)).toBe(true));
it.each(["I hate facebook", "telegram is slow lately", "my email is down", "of course", "see you @ 5"])
  ("allows: %s", (t) => expect(containsSocialHandle(t)).toBe(false));
it.each(["fuck", "f u c k", "fuuuck", "pussy", "dick", "sh1t", "send nudes", "so horny", "sex chat?", "n u d e s"])
  ("blocks %s", (t) => expect(containsProfanity(t)).toBe(true));
it.each(["hello", "Scunthorpe", "assessment", "cumulative", "Dickens", "gago", "putangina"])
  ("allows %s", (t) => expect(containsProfanity(t)).toBe(false));
it("isCleanNickname rejects contact details and sexual terms", () => {
  expect(isCleanNickname("mika_ig")).toBe(true);
  expect(isCleanNickname("horny_guy")).toBe(false);
  expect(isCleanNickname("09171234567")).toBe(false);
});
it("moderateText rejects empty, long, link, contact, profanity", () => {
  expect(moderateText("   ", 1000)).toEqual({ ok: false, reason: "empty" });
  expect(moderateText("😀".repeat(1001), 1000)).toEqual({ ok: false, reason: "too_long" });
  expect(moderateText("😀".repeat(1000), 1000).ok).toBe(true);
  expect(moderateText("see www.x.com", 1000)).toEqual({ ok: false, reason: "link" });
  expect(moderateText("text me 09171234567", 1000)).toEqual({ ok: false, reason: "contact" });
  expect(moderateText("add me on ig mika24", 1000)).toEqual({ ok: false, reason: "contact" });
  expect(moderateText("fuck off", 1000)).toEqual({ ok: false, reason: "profanity" });
  expect(moderateText("  hi  ", 1000)).toEqual({ ok: true, text: "hi" });
});
```
- [ ] **Step 2: Run** → FAIL.
- [ ] **Step 3: Implement.** Links: NFKC + lower-case; replace explicit obfuscations only (`(dot)`, `[dot]`, `{dot}`, `[.]`, `(.)`, ` dot ` between two word characters) with `.`; then match `https?://`, `\bwww\.`, or a bare domain **inside a single no-space token**: `\b[a-z0-9-]*[a-z][a-z0-9-]*\.(TLD)\b`. TLD list (in file): generic `com net org io co app dev chat me xyz info biz online site live link club top shop store tv gg ly` plus ISO country codes **except** common words `at be by do go he hi id if in is it me my no of oh ok on or so to up us we` (`me` stays only in the generic list when not followed by more text: keep the `me.to` allowed case passing). If `obscenity` flags an allowed case above, add a whitelist term rather than dropping the test. Phone: count digits across separators but reset on letters or 2+ spaces, so "room 1203" and "top 10 of 2024" stay allowed. Social: the `of` abbreviation only counts next to a handle-like token, never alone ("of course").
- [ ] **Step 4: Run** → PASS; `npm run check` → PASS.
- [ ] **Step 5: Commit** `feat(shared): add link, contact and profanity text moderation`

---

### Task 4: Identity, hashing, bot check and ban store

**Files:**
- Create: `worker/http/deviceCookie.ts`, `worker/http/requestInfo.ts`, `worker/botcheck/BotCheck.ts`, `worker/botcheck/TurnstileBotCheck.ts`, `worker/moderation/identityHash.ts`, `worker/moderation/banStore.ts`, `worker/support/hash.ts`, `worker/retention/Encryptor.ts`, `worker/retention/RetentionStore.ts`, `migrations/0001_init.sql`
- Modify: `wrangler.jsonc` (`kv_namespaces: [{ binding: "BANS" }]`, `d1_databases: [{ binding: "DB", database_name: "swoony", migrations_dir: "migrations" }]`), `worker/deps.ts`, `vitest.worker.config.ts` (`readD1Migrations` + setup file `applyD1Migrations`)
- Test: `worker/http/deviceCookie.test.ts`, `worker/http/requestInfo.test.ts`, `worker/botcheck/TurnstileBotCheck.test.ts`, `worker/moderation/banStore.test.ts`, `worker/deps.test.ts`

**Interfaces:**
- Produces:
  - `DEVICE_COOKIE = "sw_dev"`; `class DeviceCookies { constructor(secrets: string[], secure: boolean); read(request: Request): Promise<string | null>; issue(deviceId?: string): Promise<{ deviceId: string; setCookie: string }> }`: value `<uuid>.<base64url HMAC-SHA256>`; signs with `secrets[0]`, verifies with any; attributes `HttpOnly; SameSite=Lax; Path=/; Max-Age=31536000` plus `Secure` when `secure`. Constructor throws if no secret or any secret < 32 chars.
  - `clientIp(request: Request): string` (`CF-Connecting-IP`, fallback `"127.0.0.1"`); `networkKey(ip: string): string` (IPv4 unchanged; IPv6 expanded, first four hextets + `"::/64"`); `isSameOrigin(request: Request): boolean` (Origin host === URL host; missing → false).
  - `class IdentityHasher { constructor(secret: string); hash(value: string): Promise<string> }` (HMAC-SHA256 hex; throws if secret < 32 chars).
  - `interface BotCheck { verify(token: string, ip: string): Promise<boolean> }`; `class TurnstileBotCheck implements BotCheck { constructor(opts: { secret: string; expectedHostnames: string[]; expectedAction: string | null; fetcher?: typeof fetch }) }`: POSTs `secret, response, remoteip` to `https://challenges.cloudflare.com/turnstile/v0/siteverify`; returns true only if `success` and (when `expectedHostnames` non-empty) `hostname` is listed and (when `expectedAction` set) `action` matches; failures → `false` and `console.warn("bot_check_failed", { reason })` (reason is a code, never the token).
  - `interface ActiveBan { until: number }`; `class BanStore { constructor(kv: KVNamespace, db: D1Database, now: () => number); getActiveBan(deviceHash: string | null, networkHash: string): Promise<ActiveBan | null>; issueBan(deviceHash: string, networkHash: string): Promise<{ deviceUntil: number; networkUntil: number }> }`: device duration `LIMITS.deviceBanLadderMs[min(priorDeviceBans, 2)]` where `priorDeviceBans` = rows for that device with `starts_at > now - banHistoryWindowMs`; network duration always `LIMITS.networkBanMs`; KV `ban:device:<hash>` / `ban:net:<hash>` = `{"until"}` with `expirationTtl = max(60, ceil(ms/1000))`; `getActiveBan` also checks `until > now`.
  - `sha256Hex(text: string): Promise<string>`.
  - `class Encryptor { constructor(base64Key: string); encrypt(value: unknown): Promise<string>; decrypt<T>(payload: string): Promise<T> }`: AES-256-GCM via Web Crypto, random 12-byte IV per call, payload `base64url(iv).base64url(ciphertext)`; constructor throws unless the key decodes to 32 bytes.
  - `type RetainedMessage = { from: string; text: string; sentAt: number }`; `class RetentionStore { constructor(db: D1Database, encryptor: Encryptor, now: () => number, retainAllContent: boolean); logConnection(r: { userId: string; deviceHash: string; nickname: string; ip: string; country: string; joinedAt: number }): Promise<void>; logDisconnect(userId: string, leftAt: number): Promise<void>; logChatStart(chatId: string, userA: string, userB: string, at: number): Promise<void>; logChatEnd(chatId: string, at: number): Promise<void>; snapshotReport(chatId: string, reason: ReportReason, messages: RetainedMessage[]): Promise<void>; archiveMessages(chatId: string, messages: RetainedMessage[]): Promise<void> /* no-op unless retainAllContent; R2 bundle via ContentArchive (replaced logMessage, 2026-11-21) */; setHold(target: { userId?: string; chatId?: string }, until: number): Promise<number>; lookup(q: { nickname?: string; userId?: string; from: number; to: number }): Promise<LegalRecords>; purgeExpired(now: number): Promise<void> }`: nickname/ip/country and message text are stored only inside encrypted `payload`; `lookup` decrypts rows in the time window and filters; `purgeExpired` deletes connection/chat rows older than `LIMITS.connectionRetentionMs` and content rows older than `LIMITS.reportedContentRetentionMs`, skipping rows with `hold_until > now`.
  - `AppDeps = { now; botCheck: BotCheck; bans: BanStore; cookies: DeviceCookies; hasher: IdentityHasher; retention: RetentionStore }`; `createDeps(env)` also reads `RETENTION_KEY` and `RETAIN_ALL_CONTENT` (`"true"` only enables it); `createDeps(env)` reads `COOKIE_SECRETS` (comma list), `IDENTITY_HASH_SECRET`, `TURNSTILE_SECRET`, `TURNSTILE_HOSTNAMES` (comma list), `DEV_INSECURE_COOKIES` (`"1"` → `secure: false`), `expectedAction: "enter"` when hostnames are set.
- D1 `migrations/0001_init.sql`:

```sql
CREATE TABLE reports (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  reported_device TEXT NOT NULL,
  reporter_device TEXT,
  reporter_network TEXT,
  source TEXT NOT NULL CHECK (source IN ('user','system')),
  reason TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE INDEX reports_reported_created ON reports (reported_device, created_at);
CREATE TABLE bans (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  device_hash TEXT NOT NULL,
  network_hash TEXT NOT NULL,
  level INTEGER NOT NULL,
  starts_at INTEGER NOT NULL,
  device_expires_at INTEGER NOT NULL,
  network_expires_at INTEGER NOT NULL
);
CREATE INDEX bans_device ON bans (device_hash, starts_at);
CREATE TABLE connection_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id TEXT NOT NULL,
  device_hash TEXT NOT NULL,
  payload TEXT NOT NULL,
  joined_at INTEGER NOT NULL,
  left_at INTEGER,
  hold_until INTEGER
);
CREATE INDEX connection_log_joined ON connection_log (joined_at);
CREATE INDEX connection_log_user ON connection_log (user_id);
CREATE TABLE chat_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  chat_id TEXT NOT NULL,
  user_a TEXT NOT NULL,
  user_b TEXT NOT NULL,
  started_at INTEGER NOT NULL,
  ended_at INTEGER,
  hold_until INTEGER
);
CREATE INDEX chat_log_started ON chat_log (started_at);
CREATE TABLE content_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  chat_id TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('report_snapshot','all_content')),
  report_reason TEXT,
  payload TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  hold_until INTEGER
);
CREATE INDEX content_log_created ON content_log (created_at);
CREATE INDEX content_log_chat ON content_log (chat_id);
```
All `*_device` / `*_network` / `*_hash` columns hold `IdentityHasher` output, never raw values.

- [ ] **Step 1: Write failing tests.**

```ts
const SECRET = "x".repeat(32);
it("round-trips a signed device id and verifies with a rotated-out secret", async () => {
  const old = new DeviceCookies([SECRET], true);
  const { deviceId, setCookie } = await old.issue();
  const req = new Request("http://x", { headers: { Cookie: setCookie.split(";")[0]! } });
  expect(await new DeviceCookies(["y".repeat(32), SECRET], true).read(req)).toBe(deviceId);
});
it("rejects tampered and foreign-secret cookies", async () => { /* flip last char → null; other secret only → null */ });
it("rejects short secrets", () => expect(() => new DeviceCookies(["short"], true)).toThrow());
it("adds Secure only when secure", async () => {
  expect((await new DeviceCookies([SECRET], true).issue()).setCookie).toMatch(/HttpOnly; SameSite=Lax; Path=\/; Max-Age=31536000; Secure/);
  expect((await new DeviceCookies([SECRET], false).issue()).setCookie).not.toMatch(/Secure/);
});
it("networkKey groups IPv6 by /64 and keeps IPv4", () => {
  expect(networkKey("2001:db8:1:2:aaaa::1")).toBe(networkKey("2001:0db8:0001:0002:ffff:1:2:3"));
  expect(networkKey("1.2.3.4")).toBe("1.2.3.4");
});
it("isSameOrigin", () => { /* same host true; evil.example false; missing Origin false */ });
it("IdentityHasher is deterministic and keyed", async () => {
  const a = new IdentityHasher(SECRET), b = new IdentityHasher("z".repeat(32));
  expect(await a.hash("1.2.3.4")).toBe(await a.hash("1.2.3.4"));
  expect(await a.hash("1.2.3.4")).not.toBe(await b.hash("1.2.3.4"));
});
it("TurnstileBotCheck checks success, hostname and action", async () => {
  const mk = (body: object) => new TurnstileBotCheck({ secret: "s", expectedHostnames: ["swoony.chat"], expectedAction: "enter", fetcher: async () => Response.json(body) });
  expect(await mk({ success: true, hostname: "swoony.chat", action: "enter" }).verify("t", "1.1.1.1")).toBe(true);
  expect(await mk({ success: true, hostname: "evil.example", action: "enter" }).verify("t", "1.1.1.1")).toBe(false);
  expect(await mk({ success: true, hostname: "swoony.chat", action: "other" }).verify("t", "1.1.1.1")).toBe(false);
  expect(await mk({ success: false }).verify("t", "1.1.1.1")).toBe(false);
});
it("TurnstileBotCheck fails closed on network error and throws without secret", async () => { /* fetcher throws → false; secret "" → throw */ });
it("device ladder escalates 1h, 24h, 7d; network ban is always 1h", async () => {
  const t = 1_000_000; const store = new BanStore(env.BANS, env.DB, () => t);
  const b1 = await store.issueBan("dev1", "netA"); const b2 = await store.issueBan("dev1", "netB"); const b3 = await store.issueBan("dev1", "netC");
  expect([b1.deviceUntil, b2.deviceUntil, b3.deviceUntil]).toEqual([t + 3_600_000, t + 86_400_000, t + 604_800_000]);
  expect([b1.networkUntil, b3.networkUntil]).toEqual([t + 3_600_000, t + 3_600_000]);
  expect((await store.issueBan("dev9", "netA")).deviceUntil).toBe(t + 3_600_000);
});
it("finds bans by device or network and expires them", async () => {
  let t = 0; const store = new BanStore(env.BANS, env.DB, () => t);
  await store.issueBan("dev2", "netZ");
  expect(await store.getActiveBan("dev2", "other")).not.toBeNull();
  expect(await store.getActiveBan(null, "netZ")).not.toBeNull();
  t = 3_600_001;
  expect(await store.getActiveBan(null, "netZ")).toBeNull();
});
it("Encryptor round-trips and rejects bad keys and tampering", async () => { /* encrypt→decrypt equal; two encryptions differ; 16-byte key throws; flipped ciphertext char → decrypt throws */ });
it("RetentionStore keeps identifiers only inside encrypted payloads", async () => {
  await deps.retention.logConnection({ userId: "u1", deviceHash: "h1", nickname: "Mika", ip: "1.2.3.4", country: "PH", joinedAt: 0 });
  const row = await env.DB.prepare("SELECT * FROM connection_log WHERE user_id = 'u1'").first();
  expect(JSON.stringify(row)).not.toContain("1.2.3.4"); expect(JSON.stringify(row)).not.toContain("Mika");
  expect((await deps.retention.lookup({ nickname: "mika", from: 0, to: 1 })).connections[0]!.ip).toBe("1.2.3.4");
});
it("archiveMessages does nothing while RETAIN_ALL_CONTENT is off", async () => { /* replaced the logMessage test, 2026-11-21 */ });
it("purgeExpired honours retention periods and legal holds", async () => { /* connection 6 months + 1 ms gone; content 1 year kept until 1 year + 1 ms; held row kept */ });
it("createDeps refuses missing or short secrets", () => { /* env without COOKIE_SECRETS → throws */ });
```
- [ ] **Step 2: Run** `npm run test:worker` → FAIL.
- [ ] **Step 3: Implement** per Interfaces (Web Crypto; verification via `crypto.subtle.verify`).
- [ ] **Step 4: Run** → PASS; `npm run check` → PASS.
- [ ] **Step 5: Commit** `feat(worker): add identity, bot check, ban store and encrypted retention store`

---

### Task 5: Lobby Durable Object: entry, sessions and sockets

**Files:**
- Create: `worker/lobby/Lobby.ts`, `worker/lobby/userTable.ts`, `worker/support/rateLimit.ts`, `shared/protocol/api.ts`, `shared/protocol/lobby.ts`, `worker/test/helpers.ts`
- Modify: `wrangler.jsonc` (`durable_objects.bindings: [{ name: "LOBBY", class_name: "Lobby" }, { name: "CHAT_ROOM", class_name: "ChatRoom" }]`, `migrations: [{ tag: "v1", new_sqlite_classes: ["Lobby", "ChatRoom"] }]`; add an empty `ChatRoom` class now so the migration never changes), `worker/index.ts`, `worker/app.ts`
- Test: `worker/lobby/session.test.ts`, `worker/support/rateLimit.test.ts`

**Interfaces:**
- Consumes: Tasks 2–4.
- Produces:
  - `lobbyStub(env: Env): DurableObjectStub<Lobby>` = `env.LOBBY.get(env.LOBBY.idFromName("global"), { locationHint: "apac" })` (verify the option name in docs).
  - HTTP (`shared/protocol/api.ts`):
    - `GET /api/session` → refreshes the device cookie; `SessionBootstrap = { me: PublicUser | null; suggestedCountry: string | null; ban: ActiveBan | null }`.
    - Every `/api/*` route except `/api/health` first returns `451 {error:"region_unavailable"}` when `isBlockedCountry(request.cf?.country)`.
    - `POST /api/session` body `EnterRequest = ProfileInput & { confirmedAdult: true; turnstileToken: string }`. **Check order:** (1) `isSameOrigin` else `403 {error:"bad_origin"}`; (2) device cookie (issue if missing); (3) ban by device/network hash → `403 {error:"banned", until}`; (4) live session for device → `200 { me }`; (5) `profileSchema` + `confirmedAdult` → `400 {error:"invalid_profile", field}`; (6) `isCleanNickname` → `400 {error:"bad_nickname"}`, bio `moderateText` → `400 {error:"bad_bio", reason}`; (7) entry limits (device, network) → `429 {error:"rate_limited"}`; (8) `botCheck.verify` → `403 {error:"bot_check_failed"}`; (9) `lobby.join` → `201 { me }` or `409 {error:"nickname_taken"}`.
    - `GET /api/lobby` upgrade → `403` foreign origin; `401` no cookie/session; `403 {banned}`; else forwarded to the Lobby with `X-Swoony-Device` set by the worker (incoming `X-Swoony-*` headers deleted first).
  - Lobby RPC: `join(input: { deviceId: string; ip: string; profile: Profile; now: number }): Promise<{ ok: true; me: PublicUser } | { ok: false; error: "nickname_taken" | "rate_limited" }>`; on success `join` calls `RetentionStore.logConnection` (userId, device hash, nickname, ip, country, joinedAt); `getSession(deviceId: string): Promise<PublicUser | null>`; `sessionGate(deviceId: string | null): Promise<{ maintenance: MaintenanceState; me: PublicUser | null }>` (added 2026-11-20: one call for `GET`/`POST /api/session`; socket upgrades rely on `Lobby.fetch` and `authorizeChat` for the session check); `resetForTests(): Promise<void>` (throws unless `env.ALLOW_TEST_RESET === "1"`; deletes all storage and in-memory state).
  - `support/rateLimit.ts`: `interface RateLimiter { hit(key: string, now: number): boolean /* true = allowed */ }`; `class MemoryRateLimiter implements RateLimiter { constructor(count: number, windowMs: number) }` (resets on eviction; used for per-chat and per-socket limits); `class SqlRateLimiter implements RateLimiter { constructor(sql: SqlStorage, bucket: string, count: number, windowMs: number); prune(now: number): void }` (table `rate_events(bucket, key, at)`; used for entries, reports, strikes so they survive hibernation and deploys).
  - `userTable.ts`: `class UserTable { constructor(sql: SqlStorage); ensureSchema(): void; insert(row: UserRow): void; byDevice(deviceId: string): UserRow | null; byUserId(userId: string): UserRow | null; nicknameTaken(key: string): boolean; all(): UserRow[]; update(deviceId: string, patch: Partial<UserRow>): void; delete(deviceId: string): void }`; `UserRow = PublicUser & { deviceId: string; ip: string; joinedAt: number; lastActiveAt: number; disconnectedAt: number | null }`. Tables: `users(device_id PK, user_id UNIQUE, nickname_key UNIQUE, nickname, gender, age, country, bio, ip, joined_at, last_active_at, disconnected_at)`, `blocks(blocker, blocked, PK(blocker, blocked))`, `chats(chat_id PK, user_a, user_b, a_spoke INTEGER, b_spoke INTEGER, created_at)`, `contacts(owner, other, other_device_hash, other_network_hash, other_spoke INTEGER, PK(owner, other))`, `rate_events`.
  - Lobby socket: frames > `LIMITS.maxFrameBytes` are dropped unparsed; per-socket `MemoryRateLimiter(LIMITS.lobbyMessagesPerSocket)` (miss → `{type:"notice", code:"slow_down"}`, not a strike); attachment `{ deviceId, userId }`; on accept sends `{ type: "hello"; me: PublicUser; online: number; chats: OpenChat[] }` (`OpenChat = { chatId: string; peer: PublicUser }`, empty until Task 8); `setWebSocketAutoResponse(new WebSocketRequestResponsePair("ping", "pong"))`.
  - `userId` = `crypto.randomUUID()` per session, the only id sent to clients.
  - `worker/test/helpers.ts` (all later worker tests use only these):
    - `deps: AppDeps` (real deps from test env, with `botCheck` passing unless token `"fail"`).
    - `uniqueName(prefix?: string): string` (e.g. `u7f3a9`), `uniqueIp(): string` (distinct IPv4 per call).
    - `enter(profile?: Partial<ProfileInput>, opts?: { ip?: string; cookie?: string; confirmedAdult?: boolean; turnstileToken?: string; origin?: string }): Promise<{ cookie: string; me: PublicUser; res: Response }>`: defaults: unique nickname, `female`, 24, `PH`, unique IP, same origin.
    - `openLobby(cookie: string, opts?: { origin?: string }): Promise<TestSocket>`; `openChat(cookie: string, chatId: string): Promise<TestSocket>`; `chatUpgrade(cookie: string, chatId: string, headers?: Record<string, string>): Promise<Response>`.
    - `class TestSocket { next<T extends string>(type: T, timeoutMs?: number): Promise<Msg<T>>; nextWhere<T extends string>(type: T, pred: (m: Msg<T>) => boolean): Promise<Msg<T>>; send(msg: object): void; sendRaw(raw: string): void; close(): void }`: buffers every incoming message per type (nothing is dropped); `next` resolves with the oldest unread message of that type.
    - `deviceIdFrom(cookie: string): Promise<string>`; `resetLobby(): Promise<void>`; Task 7 adds clock/alarm helpers; Task 8 adds `twoUsersInLobby()`, `openPairChat()`, `reopenChat()`, `chatMessageCount()`.

- [ ] **Step 1: Write failing tests** (`beforeEach(resetLobby)`).

```ts
it("enters with a valid profile and returns a public user without device id", async () => {
  const { res, me } = await enter();
  expect(res.status).toBe(201);
  expect(Object.keys(me).sort()).toEqual(["age", "bio", "country", "gender", "nickname", "userId"]);
});
it("requires 18+ confirmation", async () => expect((await enter({}, { confirmedAdult: false })).res.status).toBe(400));
it("rejects failed bot check", async () => expect((await enter({}, { turnstileToken: "fail" })).res.status).toBe(403));
it("returns 451 for blocked countries", async () => { /* request with cf.country "GB" to /api/session → 451 region_unavailable; "PH" → 200 */ });
it("rejects entry from foreign origin", async () => expect((await enter({}, { origin: "https://evil.example" })).res.status).toBe(403));
it("rejects profane nickname", async () => expect(await (await enter({ nickname: "dick_guy" })).res.json()).toEqual({ error: "bad_nickname" }));
it("nickname uniqueness is case-insensitive", async () => {
  const n = uniqueName(); await enter({ nickname: n });
  expect((await enter({ nickname: n.toUpperCase() })).res.status).toBe(409);
});
it("second tab resumes the same user", async () => {
  const first = await enter();
  const again = await enter({}, { cookie: first.cookie });
  expect(again.res.status).toBe(200);
  expect(again.me.userId).toBe(first.me.userId);
});
it("GET /api/session returns me for a live session", async () => { /* bootstrap.me.userId === me.userId */ });
it("rate-limits the 6th entry from one device within 10 minutes", async () => { /* same cookie, leave between entries via RPC removeUser in Task 7 → for now use 6 distinct invalid-bot entries: 5 → 403, 6th → 429 */ });
it("allows 30 entries per network then limits", async () => { /* 30 distinct devices same ip → 201; 31st → 429 */ });
it("banned device cannot enter and gets until", async () => {
  const { cookie } = await enter();
  await deps.bans.issueBan(await deps.hasher.hash(await deviceIdFrom(cookie)), await deps.hasher.hash(uniqueIp()));
  const again = await enter({}, { cookie });
  expect(again.res.status).toBe(403);
  expect((await again.res.json()).error).toBe("banned");
});
it("rejects lobby upgrade from foreign origin", async () => {
  const { cookie } = await enter();
  expect((await rawUpgrade("/api/lobby", cookie, "https://evil.example")).status).toBe(403);
});
it("lobby socket greets with hello", async () => {
  const { cookie, me } = await enter(); const ws = await openLobby(cookie);
  const hello = await ws.next("hello");
  expect(hello.me.userId).toBe(me.userId); expect(hello.chats).toEqual([]);
});
it("entering writes an encrypted connection record", async () => { /* enter → retention.lookup by nickname returns ip and country */ });
it("drops oversized frames and rate-limits chatty sockets", async () => { /* 5 KB frame → no response; 21 small messages in 10 s → notice slow_down */ });
// rateLimit.test.ts
it("MemoryRateLimiter allows count hits per window then blocks, then recovers", () => {
  const l = new MemoryRateLimiter(2, 1000);
  expect([l.hit("k", 0), l.hit("k", 10), l.hit("k", 20)]).toEqual([true, true, false]);
  expect(l.hit("k", 1011)).toBe(true);
});
it("SqlRateLimiter persists across instances", async () => { /* runInDurableObject: hit twice, new limiter on same sql → third blocked */ });
```
- [ ] **Step 2: Run** → FAIL.
- [ ] **Step 3: Implement** per Interfaces; `ctx.blockConcurrencyWhile(() => table.ensureSchema())` in the constructor; map the first zod issue path to `field`.
- [ ] **Step 4: Run** → PASS; `npm run check` → PASS.
- [ ] **Step 5: Commit** `feat(lobby): add lobby durable object with guest entry and sessions`

---

### Task 6: Online list, filters, presence and bio

**Files:**
- Create: `worker/lobby/listing.ts`
- Modify: `worker/lobby/Lobby.ts`, `worker/lobby/userTable.ts`, `shared/protocol/lobby.ts`
- Test: `worker/lobby/listing.test.ts`, `worker/lobby/presence.test.ts`

**Interfaces:**
- Consumes: `matchesFilter`, `userFilterSchema`, `moderateText`, `UserTable`, helpers.
- Produces (`shared/protocol/lobby.ts`, zod discriminated unions; invalid → `{ type: "error", code: "bad_message" }`):
  - Client: `{ type: "list"; requestId: string; filter: UserFilter; cursor?: string }`, `{ type: "setBio"; bio: string }`.
  - Server: `{ type: "page"; requestId: string; users: PublicUser[]; nextCursor: string | null; online: number }`, `{ type: "presence"; joined: PublicUser[]; left: string[]; updated: PublicUser[]; online: number }`, `{ type: "bioRejected"; reason: ModerationRejection }`. Every `online` count (hello, page, presence) is per viewer: people online that this viewer can see, so it leaves out the viewer and anyone on either side of a block, matching the list. The UI shows it as "N others online". A block sends both sides a fresh count.
  - `listUsers(rows: UserRow[], viewer: { userId: string; hidden: Set<string> }, filter: UserFilter, cursor: string | null, pageSize: number): { users: PublicUser[]; nextCursor: string | null }`: newest first by `joinedAt`, tie-break `userId`; cursor `"<joinedAt>:<userId>"`; excludes viewer, `hidden` (blocked either way), and users with `disconnectedAt !== null`.
  - Presence is **batched**: changes queue in memory and flush every `LIMITS.presenceBatchMs` (via `setTimeout` while awake; the alarm flushes leftovers); each recipient skips users hidden for them; `online` = users with a socket or inside grace.

- [ ] **Step 1: Write failing tests.**

```ts
it("filters, excludes viewer/hidden/disconnected and paginates newest first", () => {
  const rows = makeRows(65);
  const p1 = listUsers(rows, { userId: rows[64]!.userId, hidden: new Set([rows[63]!.userId]) }, {}, null, 30);
  expect(p1.users).toHaveLength(30); expect(p1.users[0]!.userId).toBe(rows[62]!.userId);
  const p2 = listUsers(rows, { userId: rows[64]!.userId, hidden: new Set() }, {}, p1.nextCursor, 30);
  expect(p2.users.some((u) => p1.users.some((v) => v.userId === u.userId))).toBe(false);
});
it("returns null cursor on last page", () => expect(listUsers(makeRows(3), { userId: "x", hidden: new Set() }, {}, null, 30).nextCursor).toBeNull());
it("new user appears in others' presence and filtered list", async () => {
  const a = await enter(); const wa = await openLobby(a.cookie); await wa.next("hello");
  const b = await enter({ gender: "male" }); const wb = await openLobby(b.cookie); await wb.next("hello");
  expect((await wa.next("presence")).joined.map((u) => u.userId)).toContain(b.me.userId);
  wa.send({ type: "list", requestId: "r1", filter: { genders: ["male"] } });
  expect((await wa.next("page")).users.map((u) => u.userId)).toEqual([b.me.userId]);
});
it("batches several joins into one presence message", async () => { /* 3 quick joins → one presence with 3 joined */ });
it("setBio rejects links and broadcasts accepted bio", async () => { /* link → bioRejected link; "hi" → presence.updated */ });
it("malformed message yields bad_message error", async () => { /* sendRaw("{not json") → error bad_message */ });
```
- [ ] **Step 2: Run** → FAIL.
- [ ] **Step 3: Implement** per Interfaces (`setBio` empty clears the bio).
- [ ] **Step 4: Run** → PASS; `npm run check` → PASS.
- [ ] **Step 5: Commit** `feat(lobby): add filtered online list with live presence and bio updates`

---

### Task 7: Session lifecycle: grace, idle, orphans and cleanup

**Files:**
- Modify: `worker/lobby/Lobby.ts`, `worker/lobby/userTable.ts`, `shared/protocol/lobby.ts`, `worker/test/helpers.ts`
- Test: `worker/lobby/lifecycle.test.ts`

**Interfaces:**
- Consumes: Tasks 5/6, `LIMITS.leaveGraceMs`, `LIMITS.idleKickMs`.
- Produces:
  - Client `{ type: "leave" }` (immediate removal).
  - Server `{ type: "kicked"; reason: "idle" | "abuse" | "banned" }` then close code `4000`.
  - Lobby RPC `touch(userId: string, now: number): Promise<void>`.
  - `Lobby.removeUser(deviceId: string, reason: "left" | "idle" | "abuse" | "banned"): Promise<void>`: deletes the user row, blocks rows (both directions), chat rows, contacts where they are owner, broadcasts `presence.left`, ends their chats (Task 8 hook), closes their sockets, and calls `RetentionStore.logDisconnect(userId, now)`.
  - Alarm (scheduled for `now + 15_000` while any user exists): (1) **orphan reconcile**: any user with `disconnectedAt === null` and no socket in `ctx.getWebSockets()` gets `disconnectedAt = now`; (2) remove users with `disconnectedAt <= now - leaveGraceMs`; (3) kick users with `lastActiveAt <= now - idleKickMs`; (4) `SqlRateLimiter.prune`; (5) flush pending presence.
  - Any client message except auto-response ping updates `lastActiveAt`. `webSocketClose`/`webSocketError`: no remaining sockets for the device → `disconnectedAt = now`. Reconnect inside grace clears it.
  - Helpers: `advanceLobbyClock(ms: number)`, `fireLobbyAlarm()`, `lobbySession(cookie)`, `lobbyUserCount()`, `simulateLobbyRestart()` (closes all sockets server-side without close events, via `runInDurableObject`). The Lobby reads time from `this.clock()` (default `Date.now`).

- [ ] **Step 1: Write failing tests.**

```ts
it("closing one of two sockets keeps the user online", async () => { /* two sockets, close one → lobbySession not null */ });
it("keeps user through a reconnect inside grace", async () => {
  const a = await enter(); const s = await openLobby(a.cookie); await s.next("hello"); s.close();
  await advanceLobbyClock(59_000); await fireLobbyAlarm();
  expect((await (await openLobby(a.cookie)).next("hello")).me.userId).toBe(a.me.userId);
});
it("removes user 60s after last socket closes and wipes their rows", async () => {
  const a = await enter(); const s = await openLobby(a.cookie); await s.next("hello"); s.close();
  await advanceLobbyClock(61_000); await fireLobbyAlarm();
  expect(await lobbySession(a.cookie)).toBeNull(); expect(await lobbyUserCount()).toBe(0);
});
it("orphan users without sockets are removed after a restart", async () => {
  const a = await enter(); await (await openLobby(a.cookie)).next("hello");
  await simulateLobbyRestart(); await fireLobbyAlarm(); await advanceLobbyClock(61_000); await fireLobbyAlarm();
  expect(await lobbySession(a.cookie)).toBeNull();
});
it("kicks after 30 minutes idle", async () => { /* advance 1_800_001, alarm → kicked idle */ });
it("leave removes immediately and others see left", async () => { /* wb leave → wa presence.left contains b */ });
```
- [ ] **Step 2: Run** → FAIL.
- [ ] **Step 3: Implement** per Interfaces.
- [ ] **Step 4: Run** → PASS; `npm run check` → PASS.
- [ ] **Step 5: Commit** `feat(lobby): add leave grace, idle kick and orphan cleanup`

---

### Task 8: ChatRoom Durable Object: private 1-on-1 chat

**Files:**
- Create: `worker/chat/ChatRoom.ts`, `worker/chat/chatId.ts`, `shared/protocol/chat.ts`
- Modify: `worker/lobby/Lobby.ts`, `worker/app.ts`, `shared/protocol/lobby.ts`, `worker/test/helpers.ts`
- Test: `worker/chat/chat.test.ts`

**Interfaces:**
- Consumes: Lobby (`touch`, `removeUser`), `moderateText`, `MemoryRateLimiter`, `sha256Hex`, `LIMITS`.
- Produces:
  - `chatIdFor(userA: string, userB: string): Promise<string>` = `sha256Hex(sorted ids joined by ":")`.
  - Lobby client `{ type: "openChat"; userId: string }` → `{ type: "chatOpened"; chatId; peer: PublicUser }` or `{ type: "error", code: "user_unavailable" | "slow_down" }` (`newChats` limit is a strike source; offline/blocked → `user_unavailable`). Opening creates the `chats` row and `contacts` rows for both directions (capturing each other's device/network hashes) and calls `RetentionStore.logChatStart`; chat end or self-wipe calls `logChatEnd`. Server push `{ type: "incomingChat"; chatId; from: PublicUser }`, `{ type: "chatEnded"; chatId }`. `hello.chats` lists the user's open chats.
  - Lobby RPC `authorizeChat(deviceId: string, chatId: string): Promise<{ userId: string; peerUserId: string } | null>`: non-null only if the requester's session exists, a `chats` row for `chatId` includes them, and no block exists in either direction. `notifyIncoming(peerUserId, chatId, fromUserId)`; `markSpoke(chatId, userId)` (sets `a_spoke`/`b_spoke` and the peer's `contacts.other_spoke`); `reportStrike(userId, now): Promise<"ok" | "kicked">` (Task 9 fills the logic; returns `"ok"` here); `checkDuplicate(senderId, recipientId, textHash, now): Promise<boolean>` (Task 9; returns `false` here).
  - `GET /api/chat/:chatId` upgrade → origin/cookie/ban checks; worker deletes incoming `X-Swoony-*`, calls `authorizeChat`, sets `X-Swoony-User`/`X-Swoony-Peer`, forwards to `env.CHAT_ROOM.getByName(chatId)`; unauthorized → `403`.
  - Chat protocol: client `{ type: "send"; clientId: string; text: string }`, `{ type: "resume"; afterSeq: number }`, `{ type: "typing" }`, `{ type: "seen"; seq: number }`; server `{ type: "message"; seq; from; text; sentAt; clientId? }`, `{ type: "rejected"; clientId; reason: ModerationRejection | "slow_down" | "spam" }`, `{ type: "history"; messages: ChatMessage[]; peerSeen: number }`, `{ type: "typing" }`, `{ type: "seen"; seq }`, `{ type: "ended" }` then close code `4001`.
  - **Typing and seen (added 2026-11-20):** both share `MemoryRateLimiter(chatSignalsPerUser)` per user (miss → dropped silently, no strike). `typing` is relayed to the peer's sockets only, never stored. `seen` is accepted only when `seq` is a live (not wiped) message **from the peer** and higher than the viewer's stored value; it is kept in the room's `seen (user_id, seq)` table, relayed to the peer, and returned as `peerSeen` in the peer's `history`. A restarted chat clears `seen`; `deleteAll()` wipes it with the room. Client: `sendChatTyping` at most every `typingSignalIntervalMs` while the box has text; a typing bubble (three dots, no animation under reduced motion) shows after the messages for `typingShownMs` or until the peer's message arrives; `sendChatSeen` sends the newest peer seq while the chat is open, connected and the page visible; "Seen" shows under your newest message with seq ≤ `peerSeen` (it stays after the peer replies or while newer messages are unseen or pending). An empty chat shows no preview in the Chats list.
  - ChatRoom SQLite: `messages(seq INTEGER PRIMARY KEY AUTOINCREMENT, from_user, text, sent_at)` capped at `LIMITS.chatBufferMax`; `meta(created_at, user_a, user_b, spoke_a, spoke_b)`.
  - ChatRoom RPC `end(): Promise<void>` → `ended` to sockets, close `4001`, refuse new sockets, schedule `ctx.storage.deleteAll()` at `now + LIMITS.chatReportWindowMs` (so a report right after the chat ends can still capture it). `snapshot(): Promise<RetainedMessage[]>` returns the current buffer (empty once wiped).
  - **Self-wipe alarm:** set at creation to `createdAt + LIMITS.chatMaxLifetimeMs`; on last socket close to `now + LIMITS.chatOrphanWipeMs`; on alarm, if no sockets remain or lifetime passed → `end()` and tell the Lobby to drop the chat row.
  - Send flow: `MemoryRateLimiter(messagesPerChat)` per user (miss → `rejected slow_down` + `reportStrike`); `moderateText(text, messageMax)` (link/profanity rejections are not strikes; every 3rd `contact` rejection in 10 min per user → `reportStrike`); for the sender's first `LIMITS.duplicateText.checkedMessagesPerChat` messages in this chat whose normalized text is at least `LIMITS.duplicateText.minChars` long, call `checkDuplicate` (true → `rejected spam` + strike); append (and, while `RETAIN_ALL_CONTENT` is on, queue it in `archive_pending`, flushed to `RetentionStore.archiveMessages` every `LIMITS.archiveFlushMessages` messages, at chat end and before any wipe; a failed flush keeps the rows and retries every `LIMITS.archiveRetryMs`); broadcast `message` (sender's copy carries `clientId`); first message from a user → `markSpoke`; peer has no socket → `notifyIncoming`; `touch(sender)` at most once per 60 s.
  - Block (Task 9) and `removeUser` (Task 7) call `ChatRoom.end()`; peers' lobby sockets get `chatEnded`; UI says "<nickname> left" for both.
  - Helpers: `twoUsersInLobby()`, `openPairChat()` → `{ a, b, wa, wb, chatId, ca, cb }`, `reopenChat(socket)`, `chatMessageCount(chatId)`, `fireChatAlarm(chatId)`, `advanceChatClock(chatId, ms)`.

- [ ] **Step 1: Write failing tests.**

```ts
it("opens a chat and relays a message to the peer via incomingChat", async () => {
  const { a, b, wa, wb } = await twoUsersInLobby();
  wa.send({ type: "openChat", userId: b.me.userId });
  const { chatId } = await wa.next("chatOpened");
  const ca = await openChat(a.cookie, chatId);
  ca.send({ type: "send", clientId: "c1", text: "hey!" });
  expect((await ca.next("message")).clientId).toBe("c1");
  const inc = await wb.next("incomingChat");
  expect((await (await openChat(b.cookie, inc.chatId)).next("history")).messages.map((m) => m.text)).toEqual(["hey!"]);
});
it("hello lists open chats after reconnect", async () => { /* after chatOpened, new lobby socket → hello.chats has chatId */ });
it("3 contact-detail rejections in 10 minutes count as a strike", async () => { /* send phone number 3x → rejected contact each; lobby socket gets notice slow_down after the 3rd */ });
it("rejects links without a strike and the 6th message within 5s with slow_down", async () => { /* link → rejected link; 6 quick → m6 slow_down */ });
it("resume returns only messages after afterSeq", async () => { /* two messages, reopen, resume afterSeq=m1.seq → ["two"] */ });
it("third party cannot join a chat", async () => { /* chatUpgrade by stranger → 403 */ });
it("ignores client-supplied identity header", async () => { /* stranger with X-Swoony-User: b.userId → 403 */ });
it("blocked user cannot reconnect to the chat", async () => { /* a blocks b (Task 9 message stubbed via direct RPC here), b chatUpgrade → 403 */ });
it("peer leaving ends the chat and wipes it after the report window", async () => { /* wb leave → ca ended (4001), wa chatEnded; count still > 0; advanceChatClock 600_001 + fireChatAlarm → count 0 */ });
it("chat start and end are recorded in the retention store", async () => { /* lookup by userId → chats has started_at and ended_at */ });
it("chat self-wipes after both sockets are gone for 2 minutes", async () => { /* close ca, cb; advanceChatClock 120_001; fireChatAlarm → count 0 */ });
it("chat self-wipes after 24 hours even with sockets", async () => { /* advanceChatClock 86_400_001; fireChatAlarm → ended */ });
it("blocks the 11th new chat within a minute", async () => { /* 11 users, 11 openChat → 11th error slow_down */ });
```
- [ ] **Step 2: Run** → FAIL.
- [ ] **Step 3: Implement** per Interfaces. The ChatRoom sends `history` only in answer to `resume` (the slice after `afterSeq`); the client always sends `resume` when its socket opens (changed 2026-11-20: the old push on connect sent history twice).
- [ ] **Step 4: Run** → PASS; `npm run check` → PASS.
- [ ] **Step 5: Commit** `feat(chat): add private chat rooms with moderation, resume and self-wipe`

---

### Task 9: Block, report, auto-ban and abuse signals

**Files:**
- Create: `worker/moderation/reportStore.ts`, `worker/lobby/abuse.ts`, `worker/moderation/retention.ts`
- Modify: `worker/lobby/Lobby.ts`, `worker/chat/ChatRoom.ts`, `worker/index.ts` (`scheduled`), `wrangler.jsonc` (`triggers: { crons: ["0 3 * * *"] }`), `shared/protocol/lobby.ts`
- Test: `worker/moderation/reportStore.test.ts`, `worker/lobby/abuse.test.ts`, `worker/lobby/moderation.test.ts`, `worker/moderation/retention.test.ts`

**Interfaces:**
- Consumes: `BanStore`, `IdentityHasher`, `SqlRateLimiter`, Lobby `removeUser`, `ChatRoom.end`, `LIMITS`.
- Produces:
  - Client `{ type: "block"; userId }` → ends their chat, hides both ways for the session → `{ type: "blocked"; userId }`.
  - Client `{ type: "report"; userId; reason: ReportReason }` → always blocks; answers `{ type: "reported"; userId }` (counted or not) or `{ type: "error", code: "slow_down" }` (`reportsPerDevice`, persisted) or `error user_unavailable` (self or never-seen user). **Counted** only if the reporter's `contacts` row for the target has `other_spoke = 1`; the contact row survives the target leaving, so departed users can still be reported for the rest of the reporter's session. Every report (counted or not) asks the pair's ChatRoom for `snapshot()` (available until `chatReportWindowMs` after the chat ended) and stores it with `RetentionStore.snapshotReport(chatId, reason, messages)` (1 year).
  - `class ReportStore { constructor(db: D1Database); addUserReport(r: { reportedDevice: string; reporterDevice: string; reporterNetwork: string; reason: ReportReason; createdAt: number }): Promise<void>; addSystemKick(reportedDevice: string, createdAt: number): Promise<void>; independentReporters(reportedDevice: string, since: number): Promise<number>; systemKicks(reportedDevice: string, since: number): Promise<number> }` (all ids are hashes).
  - Ban rule: after a counted report, if `independentReporters(target, now - 24h) >= 3` (min of distinct reporter devices and distinct reporter networks) → `bans.issueBan(targetDeviceHash, targetNetworkHash)`; if the target is online → `removeUser(device, "banned")`.
  - `class StrikeTracker { constructor(limiter: SqlRateLimiter); strike(userId: string, now: number): boolean /* true = kick */ }`; `class DuplicateTextDetector { constructor(users: number, windowMs: number); record(senderId, recipientId, textHash, now): boolean }` (in memory; reset on eviction accepted).
  - `reportStrike` → `{ type: "notice"; code: "slow_down" }`; kick on 3rd strike → `removeUser(device, "abuse")` + `addSystemKick`; `systemKicks(device, now - 24h) >= 3` → `issueBan`.
  - `purgeExpired(db: D1Database, now: number): Promise<void>` deletes reports older than `LIMITS.moderationRetentionMs` and bans whose both expiries are older than `LIMITS.moderationRetentionMs`. The `scheduled` handler runs it and `RetentionStore.purgeExpired(now)`.

- [ ] **Step 1: Write failing tests.**

```ts
async function chattedReport(target, reporterIp: string) {
  const r = await enter({}, { ip: reporterIp }); const wr = await openLobby(r.cookie); await wr.next("hello");
  wr.send({ type: "openChat", userId: target.me.userId }); const { chatId } = await wr.next("chatOpened");
  const ct = await openChat(target.cookie, chatId); ct.send({ type: "send", clientId: "x", text: "hello" }); await ct.next("message");
  wr.send({ type: "report", userId: target.me.userId, reason: "harassment" }); await wr.next("reported");
}
it("3 counted reports from 3 networks ban the target device and network", async () => {
  const target = await enter(); const wt = await openLobby(target.cookie); await wt.next("hello");
  for (const ip of ["10.0.0.1", "10.1.0.1", "10.2.0.1"]) await chattedReport(target, ip);
  expect((await wt.next("kicked")).reason).toBe("banned");
  expect((await enter({}, { cookie: target.cookie })).res.status).toBe(403);
});
it("reports from one network count once", async () => { /* 3 reporters same ip → no kick */ });
it("report without a two-way chat does not count but still answers reported", async () => { /* target never spoke → reported, no ban after 3 */ });
it("departed target can still be reported by someone who chatted with them", async () => { /* target leaves, report → counted */ });
it("block hides users both ways and ends their chat", async () => { /* block → cb ended; b list excludes a */ });
it("11th report in an hour is rate limited", async () => { /* expect error slow_down */ });
it("StrikeTracker kicks on 3rd strike in 10 minutes and survives a new instance", async () => { /* via runInDurableObject */ });
it("DuplicateTextDetector flags same text to 5 different users in a minute", () => {
  const d = new DuplicateTextDetector(5, 60_000);
  expect(["r1", "r2", "r3", "r4", "r5"].map((r, i) => d.record("s", r, "h", i))).toEqual([false, false, false, false, true]);
  expect(d.record("s", "r1", "h", 10)).toBe(false);
});
it("3 system kicks in 24h ban the device", async () => { /* force 9 strikes over time → banned */ });
it("purgeExpired removes old reports and long-expired bans only", async () => { /* insert old + fresh, purge, count */ });
it("a report stores an encrypted snapshot of that chat", async () => { /* chattedReport → retention.lookup content has kind report_snapshot with the messages */ });
it("a report right after the peer left still captures the chat", async () => { /* target leaves, report within 10 min → snapshot non-empty */ });
```
- [ ] **Step 2: Run** → FAIL.
- [ ] **Step 3: Implement** per Interfaces; `scheduled` calls `purgeExpired(env.DB, Date.now())`.
- [ ] **Step 4: Run** → PASS; `npm run check` → PASS.
- [ ] **Step 5: Commit** `feat(moderation): add block, brigading-resistant reports and abuse detection`

---

### Task 9B: Owner tools for legal requests

**Files:**
- Create: `worker/admin/adminRoutes.ts`, `scripts/legal/lookup.ts`, `scripts/legal/ban.ts`, `scripts/legal/takedown.ts`, `scripts/legal/hold.ts`, `docs/legal/runbook.md`
- Modify: `worker/app.ts`, `worker/deps.ts`, `worker/lobby/Lobby.ts`
- Test: `worker/admin/adminRoutes.test.ts`

**Interfaces:**
- Consumes: `RetentionStore`, `BanStore`, `IdentityHasher`, Lobby, ChatRoom.
- Produces:
  - Secret `ADMIN_TOKEN` (≥ 32 chars; `createDeps` throws if set but shorter). If unset, every `/api/admin/*` route returns 404.
  - All `/api/admin/*` routes require `Authorization: Bearer <ADMIN_TOKEN>`, compared in constant time (HMAC both sides, `crypto.subtle.verify`); wrong or missing → **404** (don't reveal the route). No origin check (called from the owner's CLI), rate limit 10 / min per network, `Cache-Control: no-store`. Each call logs `console.info("admin_action", { action, targetHash })`, never plaintext.
  - `POST /api/admin/lookup` `{ nickname?: string; userId?: string; from: number; to: number }` → `LegalRecords = { connections: { userId; nickname; ip; country; joinedAt; leftAt }[]; chats: { chatId; userA; userB; startedAt; endedAt }[]; content: { chatId; kind; reason; messages: RetainedMessage[]; createdAt }[] }`.
  - `POST /api/admin/ban` `{ userId: string }` → bans the device + network from the retained connection record via `BanStore.issueBan`; Lobby RPC `adminRemove(userId)` kicks them if online (`kicked banned`).
  - `POST /api/admin/takedown` `{ chatId: string }` → ends the live chat (`ChatRoom.end()` then immediate wipe) and deletes that chat's `content_log` rows unless held; archived `content_archive` bundles are held for 1 year from the takedown instead of deleted; returns counts.
  - `POST /api/admin/hold` `{ userId?: string; chatId?: string; until: number }` → `RetentionStore.setHold` (preservation extension on notice from authorities).
  - Scripts (`npx tsx scripts/legal/<name>.ts ...`) read `SWOONY_ADMIN_URL` and `SWOONY_ADMIN_TOKEN` from the owner's shell environment (never from the repo) and print JSON; `lookup.ts` can also write CSV for a subpoena response.
  - `docs/legal/runbook.md`, plain language, for the owner: (1) takedown notice: verify the sender, act within 24 h (lookup → ban → takedown), keep a record; (2) report to the DOJ within 3 days (template email listing what was blocked/taken down); (3) subpoena: verify it is official, export only the records it describes; (4) preservation request: set a hold; (5) data breach: notify the NPC within 72 h (template); (6) where the abuse mailbox is and how often to check it.

- [ ] **Step 1: Write failing tests.**

```ts
it("admin routes 404 without the right token", async () => { /* no header, wrong token → 404; right token → 200 */ });
it("lookup returns decrypted records for a nickname in a time window", async () => { /* enter "Mika" → lookup nickname "mika" → connections[0].ip equals entry ip */ });
it("ban kicks an online user and blocks re-entry", async () => { /* ban userId → wt kicked banned; enter with same cookie → 403 */ });
it("takedown ends the chat and deletes its content rows", async () => { /* report snapshot exists → takedown → content rows 0, chat ended */ });
it("hold keeps rows past their retention period", async () => { /* hold until far future → purgeExpired after 7 months → connection row remains */ });
it("admin actions never log plaintext identifiers", async () => { /* spy console.info → no nickname/ip in args */ });
```
- [ ] **Step 2: Run** → FAIL.
- [ ] **Step 3: Implement** routes, scripts and runbook per Interfaces.
- [ ] **Step 4: Run** → PASS; `npm run check` → PASS.
- [ ] **Step 5: Commit** `feat(admin): add owner tools for legal requests`

---

### Task 10: Frontend foundation: tokens, theme, shell, store, sockets

**Files:**
- Create: `src/styles/app.css`, `src/lib/theme.ts`, `src/lib/viewport.ts`, `src/lib/ReconnectingSocket.ts`, `src/lib/api.ts`, `src/app/store.ts`, `src/components/AppShell.tsx`, `src/components/AdSlot.tsx`, `src/components/LetterTile.tsx`, `src/components/ThemeToggle.tsx`, `src/components/LiveAnnouncer.tsx`
- Modify: `chat/index.html` (external `/theme-init.js` no-flash script, viewport `width=device-width, initial-scale=1, viewport-fit=cover, interactive-widget=resizes-content`), `src/app/App.tsx`
- Test: `src/lib/theme.test.ts`, `src/lib/ReconnectingSocket.test.ts`, `src/lib/viewport.test.ts`, `src/app/store.test.ts`, `src/components/AdSlot.test.tsx`, `src/components/LetterTile.test.tsx`

**Interfaces:**
- Produces:
  - Tokens (Tailwind v4 `@theme`, `.dark` on `<html>`): `--brand-from #DB2777; --brand-to #7C3AED`; light `--bg #FBF9FA --surface #FFFFFF --border #EEE9EE --text #17131A --muted #6B6370`; dark `--bg #14101A --surface #1D1724 --border #2C2433 --text #F4F0F6 --muted #A79FB0`; `--radius 16px`; `bg-brand` gradient utility.
  - `type ThemeChoice = "system" | "light" | "dark"`; `getThemeChoice()`, `setThemeChoice(c)`, `resolveTheme(choice, systemDark)`, `useTheme()`. `public/theme-init.js` applies the same rule before paint (external file so CSP needs no hash).
  - `installViewportHeight(): () => void`: sets `--app-height` from `window.visualViewport.height` on resize/scroll (iOS keyboard fallback), falls back to `100dvh`.
  - `class ReconnectingSocket<In, Out> { constructor(opts: { url; parse: (raw: unknown) => In | null; onMessage: (m: In) => void; onStatus: (s: "connecting" | "open" | "closed") => void; onGiveUp?: () => void; onTerminal?: (code: number) => void; createSocket?; schedule?; random? }); send(m: Out): boolean; close(): void }`: backoff `min(10_000, 500 * 2^attempt)` × jitter `[0.5, 1)`; immediate retry on `visibilitychange` → visible and `online`; **stops** on any close code 4000–4999 (calls `onTerminal(code)`) or `close()`; after `LIMITS.socketGiveUpAttempts` consecutive failures without ever opening, calls `onGiveUp` (app then calls `fetchSession()` and shows entry if `me` is null); `"ping"` every 25 s while open.
  - `api.ts`: `fetchSession(): Promise<SessionBootstrap>`, `enter(body: EnterRequest): Promise<EnterResult>`, `EnterResult = { ok: true; me: PublicUser } | { ok: false; error: string; field?: string; until?: number }`.
  - Zustand `useAppStore`: `session` (`me`, `status: "loading" | "entry" | "lobby" | "kicked" | "banned"`, `kickReason`, `banUntil`), `lobby` (`users`, `online`, `filter`, `nextCursor`, `hidden: Set<string>`), `chats` (`Record<chatId, { peer; messages; pending; unread; ended; lastSeq }>`, `activeChatId`). Pure reducers: `applyHello(state, msg)` (restores `chats` from `hello.chats`), `applyPresence(state, msg)`, `applyChatMessage(state, chatId, msg)`. `lastSeq` per chat mirrored to `sessionStorage` key `swoony-seq-<chatId>` (try/catch).
  - `<AdSlot placement />` → `null` while `ADS_ENABLED` is false; else fixed box (`list-inline` 320×50, `chat-empty` 300×250) with `data-ad-placement`.
  - `<LetterTile name size? />` first letter, deterministic tint, `aria-hidden`.
  - `<LiveAnnouncer />` polite `aria-live` region; `announce(text: string)` store action.
  - `<AppShell>`: mobile single column + bottom nav (Online, Chats with unread badge, Me); height `var(--app-height, 100dvh)` with `env(safe-area-inset-bottom)` padding. Desktop (≥ 1024 px, UI polish 2026-11-19): floating rounded cards on a soft glowing canvas. Left card = wordmark, Online / Chats tabs, list, and my `AccountCard` at the bottom (opens bio + theme settings; Leave icon with confirm); it collapses to an icon rail (tabs with unread badge, compact account card), remembered in `localStorage` key `swoony-panels`. Middle = chat, or an empty state with `AdSlot chat-empty`. Right = "Chat details" (`PeerDetails` of the open chat, no ad), shown by default when a chat is open on screens ≥ 1280 px; the chat's ⓘ button hides and shows it, remembered in `swoony-panels` (`details`) (decision, replaces "not hideable"). Below 1280 px it is left out so the chat has room. `DetailsPaneContext` gives the chat `shown` and, when the pane is available, `toggle`.

- [ ] **Step 1: Write failing tests.**

```ts
it("resolveTheme follows system unless overridden", () => { /* system+dark → dark; system+light → light; light+dark → light */ });
it("getThemeChoice falls back to system when storage throws", () => { /* getItem throws → "system" */ });
it("ReconnectingSocket backs off, gives up, and stops on terminal codes", () => {
  const delays: number[] = []; const sockets: FakeSocket[] = []; const gaveUp = vi.fn(); const terminal = vi.fn();
  const rs = new ReconnectingSocket({ url: "ws://x", parse: (r) => r as never, onMessage: () => {}, onStatus: () => {}, onGiveUp: gaveUp, onTerminal: terminal,
    createSocket: () => { const s = new FakeSocket(); sockets.push(s); return s as never; }, schedule: (fn, ms) => { delays.push(ms); fn(); }, random: () => 0.99 });
  for (let i = 0; i < 5; i++) sockets[i]!.fail();
  expect(delays.slice(0, 3).map(Math.round)).toEqual([495, 990, 1980]);
  expect(gaveUp).toHaveBeenCalledOnce();
  sockets.at(-1)!.open(); sockets.at(-1)!.closeWith(4001);
  expect(terminal).toHaveBeenCalledWith(4001);
});
it("installViewportHeight tracks visualViewport height", () => { /* mock visualViewport 500 → --app-height 500px */ });
it("applyHello restores open chats; applyPresence dedupes", () => { /* ... */ });
it("AdSlot renders nothing while ads are disabled", () => { /* container empty */ });
it("LetterTile shows the first letter", () => { /* "mika" → "M" */ });
```
- [ ] **Step 2: Run** `npm run test:web` → FAIL.
- [ ] **Step 3: Implement** per Interfaces.
- [ ] **Step 4: Run** → PASS; `npm run check` → PASS; `npm run dev` → shell in both themes at 375 px and 1280 px.
- [ ] **Step 5: Commit** `feat(web): add design tokens, theme handling, app shell and socket client`

---

### Task 11: Entry screen

**Files:**
- Create: `src/features/entry/EntryScreen.tsx`, `src/features/entry/TurnstileField.tsx`
- Modify: `src/app/App.tsx` (boot: `fetchSession` → `451 region_unavailable` ? `window.location.replace("/unavailable/")` : `ban` ? banned : `me` ? lobby : entry; `api.ts` surfaces 451 as `{ ok: false, error: "region_unavailable" }`)
- Test: `src/features/entry/EntryScreen.test.tsx`

**Interfaces:**
- Consumes: `profileSchema`, `COUNTRY_CODES`, `countryName`, `isCleanNickname`, `api.enter`, `useAppStore`.
- Produces: `<EntryScreen suggestedCountry onEntered />`; `<TurnstileField onToken onExpire />` (`@marsidev/react-turnstile`, `siteKey = import.meta.env.VITE_TURNSTILE_SITE_KEY`, `options={{ appearance: "interaction-only", action: "enter" }}`; resets after any failed submit).
- Copy (exact): title "Meet someone new"; checkbox "I'm 18 or older and I agree to the Terms and Privacy Policy" (links `/terms/`, `/privacy/`); submit "Start chatting". Errors: `nickname_taken` → "That nickname is taken right now. Try another."; `bad_nickname` → "Please choose a different nickname."; `rate_limited` → "Too many tries. Please wait a few minutes."; `bot_check_failed` → "We couldn't verify you're human. Please try again."; `banned` → "You're temporarily blocked until {local time}."; `bad_origin`/network → "Something went wrong. Please refresh and try again.".

- [ ] **Step 1: Write failing tests** (mock `api.enter`; stub `TurnstileField` → `onToken("tok")`).

```tsx
it("redirects to /unavailable/ when the API answers region_unavailable", async () => { /* fetchSession mock → 451 → location.replace("/unavailable/") */ });
it("pre-selects the suggested country", () => { /* "PH" → Country shows Philippines */ });
it("disables submit until 18+ is confirmed and form is valid", async () => { /* ... */ });
it("shows inline nickname errors from shared validation", async () => { /* "a b" → /letters, numbers and _/ */ });
it("sends confirmedAdult and token, then calls onEntered", async () => { /* api.enter called with confirmedAdult true, turnstileToken "tok" */ });
it("maps nickname_taken to friendly copy and resets turnstile", async () => { /* ... */ });
```
- [ ] **Step 2: Run** → FAIL.
- [ ] **Step 3: Implement** with shadcn `Input`, `Select`, number age input, `Textarea` + `n/150` counter, `Checkbox`; every field has a `<Label>`; errors via `aria-describedby`.
- [ ] **Step 4: Run** → PASS; `npm run check` → PASS; manual entry with the Turnstile test key.
- [ ] **Step 5: Commit** `feat(entry): add guest entry screen with turnstile`

---

### Task 12: Online list, filters and profile view

**Files:**
- Create: `src/features/lobby/useLobbyConnection.ts`, `OnlineList.tsx`, `FilterBar.tsx`, `ProfileDialog.tsx`, `ReportDialog.tsx` (in `src/features/lobby/`)
- Test: `src/features/lobby/OnlineList.test.tsx`, `FilterBar.test.tsx`, `ReportDialog.test.tsx`, `useLobbyConnection.test.ts`

**Interfaces:**
- Consumes: `ReconnectingSocket`, lobby protocol, store, `matchesFilter`, `AdSlot`, `LetterTile`, `REPORT_REASONS`, `announce`.
- Produces:
  - `useLobbyConnection()`: connects `/api/lobby`; `hello` → `applyHello` (restores chats); on every open re-requests page 1; `kicked` → `status "kicked"`; `onGiveUp` → `fetchSession()` → entry when `me` is null, banned when `ban`.
  - `<OnlineList />` virtualized (`@tanstack/react-virtual`), next page within 5 rows of the end, `<AdSlot placement="list-inline" />` after row 5, row = one "Chat with {nickname}" button (LetterTile, nickname, `F · 24 · PH`, one-line bio) plus a ⋮ menu with View profile / Block / Report (UI polish 2026-11-19; the separate Chat button was dropped). Empty copy: "No one matches these filters right now."
  - `<FilterBar />` Gender, Age and Country dropdown chips (gender and country share one multi-select, applied when it closes; age range 18–99); the bar wraps instead of scrolling sideways; change resets the list; presence deltas applied only if `matchesFilter`.
  - `<ProfileDialog user />` centered dialog with `PeerDetails` (tile, nickname, `Female · 24 · Philippines`, full bio) and "Chat"; closes if that person leaves.
  - `<ReportDialog user onSubmit />` labels "Spam", "Harassment", "Seems under 18", "Sexual content", "Something else"; toast "Thanks. We've blocked {nickname} for you."

- [ ] **Step 1: Write failing tests.**

```tsx
it("renders rows and requests next page near the end", async () => { /* ... */ });
it("ignores presence joins that don't match the active filter", () => { /* ... */ });
it("changing a filter resets list and requests page 1", async () => { /* ... */ });
it("report dialog sends the chosen reason", async () => { /* "Seems under 18" → "underage" */ });
it("shows empty state copy", () => { /* ... */ });
it("goes back to entry when the session expired during a long disconnect", async () => { /* onGiveUp + fetchSession me null → status entry */ });
```
- [ ] **Step 2: Run** → FAIL.
- [ ] **Step 3: Implement** per Interfaces.
- [ ] **Step 4: Run** → PASS; `npm run check` → PASS; manual: normal + private window see each other live.
- [ ] **Step 5: Commit** `feat(lobby): add live online list with filters, profiles and reporting`

---

### Task 13: Chat screens, emoji, alerts and mobile behaviour

**Files:**
- Create: `src/features/chat/useChatConnection.ts`, `ChatScreen.tsx`, `ChatsList.tsx`, `MessageList.tsx`, `Composer.tsx`, `useUnreadTitle.ts`, `useBackToList.ts` (in `src/features/chat/`)
- Modify: `src/app/store.ts`, `src/components/AppShell.tsx`, `worker/chat/ChatRoom.ts` + `shared/protocol/chat.ts` (decision: history carries `clientId`)
- Test: `src/features/chat/ChatScreen.test.tsx`, `Composer.test.tsx`, `useUnreadTitle.test.ts`, `useBackToList.test.ts`, `useChatConnection.test.ts`

**Interfaces:**
- Consumes: chat protocol, `ReconnectingSocket`, `moderateText`, `LIMITS.messageMax`, store, `AdSlot`, `announce`.
- Produces:
  - `useChatConnection(chatId)`: one socket per chat in the Chats list (not only the visible one); on open sends `resume` with `lastSeq`; merges by `seq`; `rejected` marks pending failed; close `4001`/`ended` → `ended: true`, no retry.
  - **No duplicate own messages after a reconnect (decision):** the ChatRoom stores each message's `clientId` (sender only) and returns it in `history` messages to the sender's sockets (`ChatMessage` gains optional `clientId`; the peer never sees it). `applyChatMessage` already clears the pending entry by `clientId`, so a message stored before the socket dropped clears its pending bubble when history arrives. Pending messages are **never re-sent blindly** on reconnect: after history, any still-pending entry is marked failed with a "Tap to retry" action that sends a new `clientId`.
  - **Reload (decision):** a reloaded chat sends `resume` with `afterSeq: 0` and gets the full history, so it shows its earlier messages. Task 10's store restores a chat with `lastSeq: 0` and `readThrough` = the seq saved in `sessionStorage`; messages at or below `readThrough` do not count as unread.
  - `<Composer onSend disabled />`: grows to 5 lines; Enter sends / Shift+Enter newline on desktop; send button `aria-label="Send"`; shadcn `emoji-picker` (frimousse) in a popover; client-side `moderateText` with copy: `link` → "Links aren't allowed in chats.", `contact` → "For your safety, sharing contact details isn't allowed.", `profanity` → "Let's keep it friendly.", `too_long` → "That message is too long.", `slow_down` → "Slow down a bit.", `spam` → "That looks like spam.".
  - `<ChatScreen chatId />` header (back, LetterTile, nickname, meta, ⓘ details button (toggles the details pane on screens ≥ 1280 px, otherwise opens `PeerDetails` in a dialog), menu Block / Report), no ad slot (L11), `MessageList` (own bubbles brand gradient, auto-scroll only when at bottom), ended banner "{nickname} left" + disabled composer. Incoming messages from the non-visible chat, notices and "left" banners are passed to `announce()`.
  - `<ChatsList />` open chats, last message preview, unread badge.
  - `useUnreadTitle(totalUnread)`: `"(n) Swoony"` only while `document.hidden`; no sound.
  - `useBackToList(activeChatId, close)`: opening a chat pushes history; `popstate` closes it.

- [ ] **Step 1: Write failing tests.**

```tsx
it("does not duplicate messages delivered by history and live message", () => { /* ... */ });
it("after reload shows the full history without counting already-read messages as unread", () => { /* ... */ });
it("history clears the pending bubble of a message stored before the socket dropped", () => { /* clientId in history */ });
it("the peer never receives the sender's clientId in history", () => { /* worker test */ });
it("ended close code stops reconnecting and shows '<nickname> left'", () => { /* ... */ });
it("Composer blocks a link client-side with friendly copy", async () => { /* ... */ });
it("Enter sends and Shift+Enter adds a newline", async () => { /* ... */ });
it("announces incoming messages for a background chat", () => { /* live region text */ });
it("unread title only when hidden", () => { /* ... */ });
it("back button closes the chat instead of leaving", () => { /* ... */ });
```
- [ ] **Step 2: Run** → FAIL.
- [ ] **Step 3: Implement** (verify shadcn emoji-picker via the shadcn MCP first).
- [ ] **Step 4: Run** → PASS; `npm run check` → PASS; manual over LAN (`npm run dev -- --host`, works because the dev server sets `DEV_INSECURE_COOKIES=1`) on **an Android phone and an iPhone**: keyboard never covers the composer; lock 30 s → resumes with missed messages; reload → open chats come back.
- [ ] **Step 5: Commit** `feat(chat): add chat screens with emoji, unread alerts and mobile handling`

---

### Task 14: Static pages, legal drafts, security headers, analytics

**Files:**
- Create: `index.html` (landing), `terms/index.html`, `privacy/index.html`, `unavailable/index.html` (copy: "Swoony isn't available in your country yet."), `404.html`, `src/static/static.css`, `public/theme-init.js`, `public/_headers`, `public/robots.txt`, `public/sitemap.xml`
- Create (also): `safety/index.html`
- Modify: `vite.config.ts` (inputs `terms/index.html`, `privacy/index.html`, `safety/index.html`, `unavailable/index.html`, `404.html`)
- Test: `worker/static.test.ts` (build output), `src/static/headers.test.ts`

**Interfaces:**
- Consumes: `docs/legal/research.md` decisions (Task 0).
- Produces:
  - Landing: plain HTML + Tailwind, hero "Cosy 1-on-1 chats with new people. No sign-up.", 18+ note, "Start chatting" → `/chat/`, footer Terms / Privacy, meta description, Open Graph, `theme-color` light/dark, `theme-init.js`.
  - `terms/`, `privacy/` drafted from Task 0 decisions: 18+ only; no accounts; what is processed (nickname, profile fields, IP during session, hashed device/network ids in reports/bans, device cookie) and retention; Turnstile and Cloudflare Web Analytics as processors; prohibited conduct; automatic moderation and bans; abuse / law-enforcement contact `[CONTACT EMAIL]`. Banner "Draft: pending legal review".
  - Privacy page must include (exact core wording, from `CLAUDE.md`): "No one at Swoony reads your chats. Chats disappear from your screen when they end. To comply with Philippine law, we keep basic connection records for 6 months and the messages of all chats for 1 year, encrypted and only for law enforcement." Plus: a retention table (connection/chat records 6 months; messages of all chats 1 year; reported or taken-down chat snapshots 1 year from the report or takedown; reports and bans 6 months), the Data Protection Officer contact, data-subject rights under RA 10173, and that EU users are not targeted. Never claim "encrypted chat" or "end-to-end".
  - Terms must prohibit OSAEC/CSAEM including streaming (RA 11930 Sec. 9(a)(1)) and state the 18+ rule.
  - `faq/` (added 2026-11-20): plain-language "how it works" Q&A for users (entry, chatting, filters, privacy, cookies, block/report/bans). Every answer must match the current specs and `shared/config.ts`; the privacy answer uses the exact core wording.
  - `safety/`: how reporting and blocking work, safety tips, and contacts: `abuse@swoony.chat` for users and a separate "For law enforcement" section (official requests to the same address, sent from an official government email).
  - `public/_headers` for `/*`: `Content-Security-Policy: default-src 'self'; script-src 'self' https://challenges.cloudflare.com https://static.cloudflareinsights.com; frame-src https://challenges.cloudflare.com; connect-src 'self' wss://swoony.chat https://cloudflareinsights.com; style-src 'self' 'unsafe-inline'; font-src 'self'; img-src 'self' data:; base-uri 'none'; form-action 'self'; frame-ancestors 'none'`, `X-Content-Type-Options: nosniff`, `Referrer-Policy: strict-origin-when-cross-origin`, `Permissions-Policy: camera=(), microphone=(), geolocation=()`. Note: `_headers` applies to static assets only; `worker/app.ts` adds `X-Content-Type-Options: nosniff` and `Cache-Control: no-store` to API responses.
  - Web Analytics beacon on all pages with token from `VITE_CF_ANALYTICS_TOKEN`; omitted when empty.

- [ ] **Step 1: Write failing tests** (`_headers` has `frame-ancestors 'none'`, Turnstile origin, `wss://swoony.chat`, no inline-script allowance; built HTML has no inline `<script>` without `src`; `npm run build` emits `terms/index.html`, `privacy/index.html`, `404.html`; API responses carry `Cache-Control: no-store`).
- [ ] **Step 2: Run** → FAIL.
- [ ] **Step 3: Write** pages from the Task 0 decisions.
- [ ] **Step 4: Run** → PASS; `npm run check` → PASS; Lighthouse mobile on landing ≥ 90 performance/accessibility/SEO.
- [ ] **Step 5: Commit** `feat(web): add landing and draft legal pages with security headers`

---

### Task 14B: Online list order, country flags and "your country" filter

decision (recommended options accepted). Built 2026-11-19 (9a73a3e); this section
describes what shipped. Independent of the admin plan.

**Files:**
- Modify: `worker/lobby/listing.ts`, `worker/lobby/Lobby.ts`, `shared/protocol/lobby.ts` (cursor),
  `src/app/store.ts` (presence joins), `src/features/lobby/OnlineList.tsx`, `src/features/lobby/FilterBar.tsx`,
  `src/components/ShortMeta.tsx`
- Create: `src/components/Flag.tsx`
- Test: `worker/lobby/listing.test.ts`, `shared/protocol/lobby.test.ts`, `src/app/store.test.ts`,
  `src/features/lobby/OnlineList.test.tsx`, `src/features/lobby/FilterBar.test.tsx`, `src/components/Flag.test.tsx`

**Interfaces:**
- Consumes: the viewer's profile `country` (picked at entry, pre-filled from `request.cf.country`),
  `COUNTRY_CODES`, `countryName`, existing list paging.
- Produces:
  - **Viewer country (server):** `ListViewer` gains `country`, read from the viewer's `UserRow` in
    `Lobby.ts` when it builds the viewer for `listUsers`.
  - **Order (server, `listUsers`):** group 0 = users whose `country` equals the viewer's, group 1 =
    everyone else; inside each group newest arrival first (`joinedAt` desc, then `userId`). No
    alphabetical sorting (names like "aaa_" would game it and bury newcomers). Filtering (self, hidden,
    blocked, disconnected, `matchesFilter`) happens before grouping, exactly as today. A country filter
    for one other country therefore returns only group 1.
  - **Cursor:** `"<group>:<joinedAt>:<userId>"`, `<group>` is `0` or `1`. `LIST_CURSOR_PATTERN`
    becomes `^(?:[01]:)?\d{1,16}:[A-Za-z0-9-]{1,64}$` so an old two-part cursor still passes the
    message schema; `parseCursor` treats a two-part cursor as "start again at page 1". The position
    compare is (group asc, joinedAt desc, userId).
  - **Sections (client):** `ListRow` gains a `{ kind: "header"; label: string }` row before each
    non-empty group: "{Your country name}" for group 0 and "Everywhere else" for group 1 (a group with
    no users gets no header). Header rows are `role="presentation"`; `aria-setsize` / `aria-posinset`
    count user rows only. The ad row goes before the first user from the 6th on who is not the first
    of a group, so it never sits directly before a header. The client works out each user's group
    itself (`user.country === me.country`, the same rule the server sorts by), so the page message
    has no extra field. Header keys are stable (`header-mine`, `header-rest`).
  - **New arrivals (client):** fixes a bug where live joins were appended at the bottom of a
    newest-first list (`applyPresence`, `src/app/store.ts`). Matching presence joins are not inserted;
    the store keeps a set `lobby.pendingJoins` of their user ids. A `left` event or hiding/blocking
    removes the id; loading page 1 or changing the filter clears the set. A later page that brings a
    pending user drops them from the set. No pill or button (decision, replaced the
    earlier "{n} new people" pill): while the set is not empty and the list is scrolled to the top
    (within 16px), `OnlineList` waits `NEW_PEOPLE_BATCH_MS` (2s, batches a burst of joins) and
    re-requests page 1, so new people slide in quietly. Automatic reloads are at least
    `AUTO_RELOAD_MIN_GAP_MS` (5s) apart and only run while the tab is visible, so a busy lobby
    does not flood the Lobby DO. The timer re-reads the real scroll position before sending.
    Scrolled down, the list stays still and reloads once the user is back at the top. No request
    while one is in flight or the list is paused. A hidden `role="status"` line says "{n} new
    people added to the list" once per reload. Server side, a page-1 `list` (no cursor) does not
    count as activity, so an idle tab that keeps auto-reloading is still kicked after 30 min
    (a filter change also sends page 1; scrolling and chatting still count). Leaves and profile
    updates of listed users still apply immediately.
  - **Flags:** `<Flag code />` renders a self-hosted SVG (no emoji flags: Windows shows letters
    instead). Default package: `country-flag-icons` (per-flag SVG files), loaded lazily with
    `import.meta.glob(..., { query: "?url" })` so the bundle does not carry all ~250; verify the package
    and the Vite option with Context7 first. Small SVGs may be inlined as `data:` URLs, which the CSP
    (`img-src 'self' data:`) already allows. The flag is `aria-hidden`; an unknown code renders nothing.
  - **ShortMeta:** gender icon + age + flag + code, e.g. `♀ 21 · [flag] PH`. New requirement: the
    screen-reader text adds the full country name ("Female, 21, Philippines").
  - **Country filter:** the dropdown pins the viewer's own country at the top under the label "Your
    country", then a divider, then all other countries A to Z (the pinned one is not repeated); while
    searching, the pinned row stays if it matches.

- [ ] **Step 1: Write failing tests:**
  - listing: same-country users come before others; newest first inside each group; paging across the
    group boundary returns every user exactly once; a hidden or blocked user on either side of the
    boundary never appears; a two-part (old) cursor restarts at page 1; a malformed cursor is rejected
    by the message schema
  - store: a matching presence join adds to `pendingJoins` instead of the list; a later `left` removes
    it; page 1 and a filter change clear it
  - OnlineList: a header before each non-empty group; no header for an empty group; `aria-setsize`
    counts users only; new arrivals reload page 1 after a short batch only while at the top
  - FilterBar: own country first under "Your country", then A to Z
  - Flag: renders an image for a known code, nothing for an unknown one
  - ShortMeta: screen-reader text includes the country name
- [ ] **Step 2: Run** → FAIL.
- [ ] **Step 3: Implement** per Interfaces.
- [ ] **Step 4: Run** → PASS; `npm run check` → PASS; manual: two browsers with different countries see
  their own country first; flags render on Windows Chrome.
- [ ] **Step 5: Commit** `feat(lobby): sort online list by your country and show flags`

---

### Task 15: Release and production deploy (owner-assisted)

**Files:**
- Create: `README.md` (run, test, deploy, env vars, rollback, smoke checklist), `scripts/loadtest.ts`
- Modify: `wrangler.jsonc` (real `database_id`, KV `id`, route `{ pattern: "swoony.chat", custom_domain: true }`)

**Interfaces:**
- Produces: live site at `https://swoony.chat`, deployed from `main`.

- [ ] **Step 1: Whole-branch review.** `superpowers:requesting-code-review` + `/security-review` across `main..build/v1`; fix findings; `npm run check` green.
- [ ] **Step 2: Merge** `build/v1` into `main` (`--no-ff`) after owner approval. All deploys come from `main`.
- [ ] **Step 3: Owner prerequisites (human):** Cloudflare account on the **Workers Paid** plan (Durable Objects + headroom); buy `swoony.chat`; log in (`/mcp` → cloudflare, or `npx wrangler login`); Turnstile widget (managed mode, hostname `swoony.chat`); Web Analytics site; billing/usage notification; email for alerts; `abuse@swoony.chat` via Cloudflare Email Routing; NPC registration of the data processing system and Data Protection Officer. **Deploy is blocked until NPC registration is done.**
- [ ] **Step 4: Resources & secrets:** follow [deployment.md](deployment.md) steps 2 to 6: `npx wrangler d1 create swoony`; `npx wrangler kv namespace create BANS`; `npx wrangler r2 bucket create swoony-archive`; paste ids; `npx wrangler d1 migrations apply swoony --remote`; `wrangler secret put` for every name in `secrets.required` (`COOKIE_SECRETS` and `IDENTITY_HASH_SECRET` via `openssl rand -base64 48`, `TURNSTILE_SECRET`, `RETENTION_KEY` via `openssl rand -base64 32` with an offline copy kept by the owner, `ADMIN_TOKEN` via `openssl rand -base64 48`, `ACCESS_TEAM_DOMAIN`, `ACCESS_AUD`, `ADMIN_EMAILS`, `ALERT_EMAIL_FROM`, `ALERT_EMAIL_TO`); `npm run deploy` refuses while any is missing. `TURNSTILE_HOSTNAMES` (`swoony.chat`) and `RETAIN_ALL_CONTENT` (`true`: all messages kept 1 year) are plain `vars` in `wrangler.jsonc`, not secrets (a secret with a var's name is rejected). Build env `VITE_TURNSTILE_SITE_KEY`, `VITE_CF_ANALYTICS_TOKEN`. Confirm `DEV_INSECURE_COOKIES` is `"0"` and `ALLOW_TEST_RESET` is `"0"` in the deployed vars.
- [ ] **Step 5: Load test** `scripts/loadtest.ts`: 500 simulated users entering, listing and sending 1 msg/5 s for 5 minutes against a `workers.dev` deploy; record Lobby CPU/latency from observability; stop and report to the owner if p95 message latency > 500 ms or errors > 1 %.
- [ ] **Step 6: Deploy** `npm run check && npm run deploy` from `main`.
- [ ] **Step 7: Monitoring:** enable Cloudflare notifications (Worker error rate, usage/billing), an external uptime check on `https://swoony.chat/api/health`, and confirm logs contain no message text/nicknames/IPs (log policy).
- [ ] **Step 8: Smoke test** on an Android phone and an iPhone: enter, see each other, chat, emoji, link blocked, lock/unlock resume, reload restores chats, block, report, theme follows system, terms/privacy load, `wrangler tail` clean.
- [ ] **Step 9: Document rollback** in `README.md`: `npx wrangler rollback` for code; Durable Object and D1 migrations are **not** rolled back by it (forward-fix only).
- [ ] **Step 10: Commit** `chore(deploy): configure production deployment`

---

## Self-review notes

- Spec coverage: every v1 row in `CLAUDE.md` maps to a task (entry 5/11, profile fields 2/11, 18+ 5/11, list + filters 6/12, bio 6/12, chat 8/13, emojis 13, visual alert 13, block/report 9/12/13, one session per device 4/5/7, link filtering 3/8/13, mobile 10–13, ad slots 10/12/13, Turnstile 4/5/11, rate limits 5/8/9, analytics 14, legal 0/14, deploy 15).
- Decisions applied: #1 brigading-resistant reports; #5 blocks stay session/userId-based; #14 one English profanity filter everywhere; #27 ad slots render nothing while off.
- Task 0 decisions applied (2026-11-18): L1 option B retention (encrypted 6-month connection/chat records, 1-year reported-chat snapshots, `RETAIN_ALL_CONTENT` switch); L2 owner legal tools (Task 9B); L3 NPC registration gates deploy; L4 Indonesia blocked; L5 UK/AU blocked; L6 EU open, not targeted; L7 every report ends that chat (reporting blocks) and snapshots it; L8 `abuse@swoony.chat` and `/safety/`.
- Planner calls (owner may override): reporting also blocks; "Leave" skips grace; 200-message buffer per live chat; chat self-wipe at 2 min orphaned / 24 h max; duplicate-text check on a sender's first 3 messages per chat, skipping texts under 10 chars (decision); per-chat and per-socket limits reset on eviction (accepted), entry/report/strike limits persisted.
