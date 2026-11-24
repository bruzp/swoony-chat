# Swoony Admin Console: Technical Plan

> **Status: built (A1 to A8).** Decisions D1 to D11 are at the end of this file. Production setup:
> [deployment.md](deployment.md).

> **For agentic workers:** same loop as [plan.md](plan.md): one task at a time, TDD,
> `npm run check`, code review, `/security-review` on every task here (all are 🔒), stop for the
> owner, commit only on approval.

**Goal:** a private web page at `swoony.chat/s-admin` that does what the four CLI tools in
`scripts/legal/` do (look up, ban, take down, hold), plus downloads (CSV and a PDF case file), an
activity log, a system health page with email alerts, and a maintenance mode. The CLI tools stay as a backup.

**Why:** the owner must act on takedown notices within 24 hours (RA 11930). Terminal commands are
slow and error-prone under that deadline.

---

## What exists today

| Piece | Where | Notes |
|---|---|---|
| Admin API | `worker/admin/adminRoutes.ts` | `POST /api/admin/{lookup,ban,takedown,hold}`; `Authorization: Bearer ADMIN_TOKEN`; 10 calls / min per network. A disabled admin, rate limit, bad token or unknown route returns a hidden 404; bad input returns 400 `invalid_request`; ban of an unknown user returns 404 `no_record` |
| Action code | same file | `lookup`, `ban`, `takedown`, `hold` are module-private consts; they must be extracted (exported) to be reused |
| Records | `worker/retention/RetentionStore.ts` | `lookup()` returns `connections` (nickname, IP, country, times), `chats`, `content` (report, takedown and all-content snapshots); payloads AES-GCM encrypted with `RETENTION_KEY` |
| Holds | `RetentionStore.setHold` | Holds can only be **extended** (`MAX(COALESCE(hold_until,0), ?)`); there is no release and no "list holds" query. This is deliberate evidence protection |
| CSV | `scripts/legal/csv.ts` | `connectionsCsv(...)` with a spreadsheet formula-injection guard; outside the Worker's tsconfig, so not importable by the Worker today |
| Admin action log | `console.info("admin_action", …)` | **Only in Workers logs, not stored.** No record of who exported what |
| Static routing | `wrangler.jsonc` | `run_worker_first: ["/api/*"]`, no `ASSETS` binding; everything else is served as a static asset without the Worker running; `public/_headers` sets `/assets/*` to `immutable` |
| Runbook | `docs/legal/runbook.md` | Written for the CLI tools |

## Global constraints

- Everything from [plan.md](plan.md) "Global Constraints" still applies (no em dashes, log policy,
  Conventional Commits, no AI attribution). Commit scope for this plan: `admin`.
- **Never log or store** decrypted content, nicknames or user IPs from records, not even in the
  audit log. The audit log stores what was done, the case reference and hashed targets.
- Admin responses are never cached (`Cache-Control: no-store`) or indexed
  (`X-Robots-Tag: noindex, nofollow`). These headers, the admin CSP and `frame-ancestors 'none'` are set
  **by the Worker**: `public/_headers` does not apply to responses the Worker generates.
- The admin page ships as a **separate bundle** under `/s-admin/assets/`, never imported by the public
  app, never under the public `/assets/*` path. The admin JavaScript holds no secrets; treat it as
  possibly visible anyway.
- The admin page never stores results in `localStorage` or `sessionStorage` (do not copy the public
  app's "remember tab" pattern).
- Every search, export and action requires a **case reference** (for example `NBI-2026-1142`):
  3 to 40 characters, letters, digits, `-`, `/`. Replace `/` with `-` before it goes into a download
  filename.
- Times are shown in PHT (UTC+8) with the UTC value in exports.

## Sign-in: two options (decision)

| | **A. Cloudflare Access (recommended)** | **B. Built into the Worker** |
|---|---|---|
| Email code | Access One-time PIN: code to the allowed email, expires in 10 min, single use; the page never reveals which emails are allowed | Worker sends a 6-digit code through a `send_email` binding to the owner's verified Email Routing address (free, no sending domain needed) |
| Throttling | Built into Access; plus a WAF rate-limiting rule on `/s-admin*` | We write it: 5 wrong codes kills the code, 3 code requests / 15 min per network, 1 h network lockout |
| IP restriction | Access policy `Require` rule: IP ranges or country | Env var allowlist checked in the Worker |
| Login history and analytics | Zero Trust dashboard: Access authentication logs and Access event analytics (top IPs, countries, failures) | Our own Activity log page |
| Extra sign-in options | Passkeys, Cloudflare account login with MFA | None |
| Code we own | Small: verify the Access token in the Worker | Large: codes, sessions, lockouts, cookies; more to secure and review |
| Cost | Zero Trust free plan (verify seat limit when setting up) | Free |

**Recommendation: A.** It covers the email code, throttling, IP restriction and login analytics
without us writing authentication code, which is the riskiest code to get wrong.

With either option, the existing `ADMIN_TOKEN` stays for the CLI tools only.

## Tasks

### Task A1: Protect `/s-admin` (owner-assisted) 🔒

- **Owner (option A):** create a Zero Trust organisation; add One-time PIN (and optionally passkeys);
  create a self-hosted Access application for `swoony.chat/s-admin*` and `swoony.chat/api/s-admin/*`
  with an Allow policy `Include: Emails = <owner email>` and `Require: IP ranges = <owner IPs>` (D2),
  session duration 8 h.
- **Close the side doors:** set `workers_dev: false` and `preview_urls: false` in `wrangler.jsonc`.
  Access only guards `swoony.chat`; on a `*.workers.dev` or preview URL the Worker check below would be
  the only gate.
- **Worker check (load-bearing, not optional):** new `worker/admin/accessAuth.ts`. Every `/s-admin*`
  and `/api/s-admin/*` request must carry a valid `Cf-Access-Jwt-Assertion`: signature checked
  against the team's JWKS (`https://<team>.cloudflareaccess.com/cdn-cgi/access/certs`, cached), alg
  pinned to RS256, `iss` = the team domain, `aud` = the application's AUD tag, not expired, `email`
  in `ADMIN_EMAILS`. Anything else gets the hidden 404. Config: `ACCESS_TEAM_DOMAIN`, `ACCESS_AUD`,
  `ADMIN_EMAILS`. Check the current Workers docs (cloudflare-docs MCP) for a built-in Access identity
  helper and a local-dev Access setting before hand-rolling verification; prefer the built-in one if it
  exists.
- **Routing:** add `/s-admin*` to `run_worker_first` and add an `ASSETS` binding so the Worker serves
  the admin bundle only after the check passes.
- Tests: valid token passes; wrong `aud`, wrong `iss`, wrong alg, expired, unknown email, missing
  header all return 404; a `/s-admin/assets/*` request without a token returns 404.

### Task A2: Admin API for the web page 🔒

- Extract `lookup`, `ban`, `takedown`, `hold` from `adminRoutes.ts` into exported functions used by
  both `/api/admin/*` (CLI, token) and the new `/api/s-admin/*` (web, Access). No copied logic.
- New `holds` route: lists active holds (`hold_until > now`) across `connection_log`, `chat_log`,
  `content_log` and `content_archive` (archived bundles count under "content"; user or chat id, kind,
  until). **No release route**: holds can only be extended
  today, on purpose (see D8).
- Same-origin check: `Origin` must equal the configured site origin (from config, so local dev works),
  `POST` only, JSON only.
- Every call takes `caseRef` (rules above).
- Its own rate limit for `/api/s-admin` (for example 60 calls / min per network), separate from the
  CLI's 10 / min, because one page load makes several calls.
- Errors the owner needs (bad input, no record) come back as readable JSON; only auth failures use the
  hidden 404.

### Task A3: Activity log (stored) 🔒

- D1 migration: `admin_audit (id, at, actor, action, case_ref, target_kind, target_hash, result,
  result_count, export_sha256, admin_network_hash, admin_country, prev_hash)`.
  - `actor`: the signed-in admin email (the owner's own data).
  - `target_hash`: identity HMAC of the user id, chat id, or lowercased nickname searched (same as
    today's `admin_action` log); `target_kind` says which.
  - `admin_network_hash`, `admin_country`: where the **admin** acted from, never the target's.
  - `result_count`: records returned by a search; `export_sha256`: hash of an exported file.
- Append only: no update or delete route. Tamper evidence (D9): each row stores `prev_hash` = SHA-256 of the previous row, so an edited or
  deleted row breaks the chain; the Activity log page shows "chain intact" or where it breaks.
  The yearly purge first writes a checkpoint row holding the hash of the last purged row, so the
  kept rows still verify from that checkpoint.
- Record: every search, ban, takedown, hold and export. Sign-ins: option A uses Access logs; option B
  writes a row per attempt.
- Kept 1 year (D3), or until a related hold ends, then purged by the existing cleanup cron.
- Tests: each action writes exactly one row; failed validation writes none; no row contains a
  nickname, IP or message text.

### Task A4: Downloads: CSV and PDF case file 🔒

- Move `scripts/legal/csv.ts` to `shared/legal/csv.ts` (keep its formula-injection guard and tests);
  the CLI imports it from there.
- `POST /api/s-admin/export` with `{caseRef, format: "csv" | "pdf", scope}` where `scope` is either
  `{query: LegalQuery}` (a whole search) or `{chatId}` (one saved chat). The server re-runs the
  lookup; the browser never builds evidence files itself.
- CSV: one zip holding connections, chats and messages CSVs (D4); verify a zip library that runs in Workers with Context7.
- PDF case file (A4 paper):
  - header: case reference, generated time (PHT and UTC), generated by, record counts;
  - sections for connections, chats and saved messages; footer "Page N of M";
  - a **records fingerprint**: SHA-256 of a canonical JSON of the exported records (keys sorted, UTC
    timestamps, UTF-8), printed on the last page with one line on how to recompute it;
  - text drawn with an embedded Unicode font (pdf-lib standard fonts are WinAnsi only and fail on
    emoji or non-Latin text); characters the font cannot draw are replaced by their code point
    (`U+1F600`) so nothing is silently dropped;
  - limits: refuse exports over a set size (for example 5,000 messages) with a message to narrow the
    dates, to stay inside Worker CPU and memory limits. A single chat exports in parts of
    `LIMITS.exportPartMessages` (4,000) archived messages (`scope.part`, header `X-Export-Parts`;
    report and takedown snapshots go in part 1), added 2026-11-21.
  - Library: `pdf-lib` with fontkit, or similar that runs in Workers; verify with Context7 first.
- The **file's** SHA-256 (of the exact bytes sent) is stored in `admin_audit.export_sha256` and shown
  in the UI after download. A file cannot contain its own hash, so it is not printed in the PDF.
- Response headers: `Content-Disposition: attachment; filename="<caseRef>-<date>.pdf"`,
  `Cache-Control: no-store`.
- Tests: CSV columns and escaping; PDF contains the case reference, counts and records fingerprint;
  emoji text does not throw; the stored file hash matches the returned bytes; over-limit returns a
  readable error.

### Task A5: Admin web pages 🔒

- Separate Vite entry `s-admin/index.html` (React, same tokens and Plus Jakarta Sans), output under
  `/s-admin/assets/`, served by the Worker after A1.
- Pages (see mockup): **Case lookup** (search by nickname or user ID, date range, case reference;
  tabs Connections / Chats / Saved messages; row actions Hold / Ban / Take down with a confirmation
  dialog that repeats the target and case reference), **Holds**, **Activity log**, **Runbook**
  (renders `docs/legal/runbook.md`).
- Downloads: "Download CSV" and "Export case file (PDF)" per search; "PDF" per saved chat.
- When the Access session has expired, API calls fail (Access redirects to its login page); detect
  this and show "Your session ended. Sign in again" with a reload button.
- Desktop first but usable on a phone (takedown notices can arrive anywhere).
- Tests: search form validation; confirmation dialogs; actions send the case reference; downloads
  call the export route; an expired session shows the sign-in message.

### Task A6: Headers, docs and runbook 🔒

- Worker sets for `/s-admin*` and `/api/s-admin/*`: strict CSP, `Cache-Control: no-store`,
  `X-Robots-Tag: noindex, nofollow`, `frame-ancestors 'none'`.
- Update `docs/legal/runbook.md`: web steps first, CLI as backup.
- Update [plan.md](plan.md) "File Structure", the CLAUDE.md "Legal" row, and add A1 to A6 to the
  CLAUDE.md 🔒 list with a link to this plan.

### Task A7: Health check and alerts 🔒

- **Public `GET /api/health`** (not behind Access, so outside monitors can reach it): checks D1
  (`SELECT 1`), KV (one read) and the Lobby Durable Object (ping). Returns `200 {"status":"ok"}`,
  `200 {"status":"maintenance"}` or `503 {"status":"down"}`, nothing else (no versions, timings or
  error text). `Cache-Control: no-store`; its own small rate limit per network.
- **Cleanup tracking:** the daily `scheduled()` job writes a row to a new D1 table
  `job_runs (id, job, started_at, finished_at, ok, deleted_counts, error_code)`; `error_code` is a short
  fixed code, never an error message with data in it. Rows older than 90 days are purged by the same job.
- **Email alerts (free):** a `send_email` binding restricted to the owner's verified Email Routing
  address. The Worker emails the owner when the cleanup job fails, and the admin health page flags
  (and the next check emails) when no successful cleanup has run for 26 hours. At most one alert
  email per problem per 6 hours.
- **Admin "System health" page:** site, database, ban store and lobby each ✅/❌ with response time;
  online count; last cleanup run (time, rows deleted per table, ok/failed); last 14 runs.
- **Uptime monitoring (owner setup, D10):** a free external monitor (recommended: UptimeRobot) checks
  `https://swoony.chat/api/health` every 5 minutes and emails the owner when it is not
  `{"status":"ok"}`. Cloudflare's own Health Checks need the Pro plan and are not used.
- Verify the `send_email` binding and `scheduled()` APIs with the cloudflare-docs MCP first.
- Tests: health returns ok, down when D1 fails, maintenance when on; no detail leaks; the cron writes a
  `job_runs` row on success and on failure; a failure sends one email, a repeat within 6 h does not.

### Task A8: Maintenance mode 🔒

- **State** lives in the Lobby Durable Object's storage (strongly consistent, one place), not KV:
  `{on, message, startedAt, startedBy}`. Toggled only from the admin page; each change writes an
  `admin_audit` row.
- **Turning it on removes everyone right away** (decision): every lobby socket is
  closed with a `maintenance` kick reason, which ends every open chat the same way as leaving (chat
  text is wiped on the usual schedule). New entries and `GET /api/session` return
  `{"error":"maintenance"}`.
- **Visitors see** a maintenance screen in the app: "Swoony is down for a short update. Please come
  back soon." (plus the admin's optional message). The static landing page stays up; "Start chatting"
  leads to that screen.
- **Still working during maintenance:** `/s-admin`, `/api/s-admin/*`, `/api/health` (reports
  `maintenance`), the daily cleanup job.
- **Turning it off** reopens entry immediately; nobody is restored (sessions were ended).
- **No-downtime note:** normal code deploys do not need maintenance mode; Workers deploys switch over
  without downtime. Use maintenance mode for risky database migrations or emergencies.
- Tests: on → all sockets closed with `maintenance`, chats ended, entry refused, health reports
  maintenance; admin routes still work; off → entry works again; both changes are audited.

## Open decisions (owner)

| # | Decision | Recommendation |
|---|---|---|
| D1 | Sign-in: Cloudflare Access (A) or built-in (B) | **Decided 2026-11-19: A** |
| D2 | IP restriction | **Decided 2026-11-19: specific IPs** (owner's list in the Access policy). If the owner's IP changes, update the policy in the Cloudflare dashboard |
| D3 | How long to keep the activity log | **Decided: 1 year**, matching the longest legal retention; rows tied to a record under hold are kept until that hold ends |
| D4 | CSV: one zip or separate files | **Decided: one zip** (connections, chats, messages CSVs) |
| D5 | Anyone besides the owner? | **Decided: owner only** |
| D6 | Path name | **Decided: `/s-admin`** (hidden by auth anyway; the name is not a security measure) |
| D7 | Login analytics | **Decided: Access dashboard.** No Google Analytics on admin pages |
| D8 | Allow releasing a hold early? | **Decided: no.** RA 11930 requires preserving data when asked; there is no early release |
| D9 | Tamper-evident activity log (hash chain)? | **Decided: yes** (`prev_hash` chain in `admin_audit`) |
| D10 | Uptime monitor | **Decided 2026-11-19: UptimeRobot free** (5-minute checks, email; setup in [deployment.md](deployment.md)) |
| D11 | Maintenance mode: keep or remove current users | **Decided 2026-11-19: remove right away** |

## Owner setup (after the build, before it works on swoony.chat)

Moved to [deployment.md](deployment.md): Cloudflare Access (step 3), alert emails (step 4), the
required secrets (step 6), migrations (step 2) and the uptime monitor (step 9).
