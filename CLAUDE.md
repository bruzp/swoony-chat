# Swoony

Anonymous, no-signup 1-on-1 chat website for adults (18+), with a modern UI.

Status: showcase project. Built and tested, not launched. The technical build plan is
[docs/plan.md](docs/plan.md); the admin console plan is [docs/admin-plan.md](docs/admin-plan.md).

## Workflow & commits

- One plan.md task at a time: TDD → `npm run check` → code review → security review on
  sensitive tasks (auth, moderation, retention, admin) → commit.
- **Keep the docs in sync.** Any change to specs, behaviour or visuals updates the affected docs
  (this file, `docs/*.md`) and the visual guide [docs/visual-guide.html](docs/visual-guide.html)
  (run Prettier on the HTML).
- **Keep the user-facing pages true.** The FAQ [faq/index.html](faq/index.html) (and Safety,
  Terms, Privacy) state facts users rely on: limits, timings, what's blocked, retention, cookies,
  how block/report/bans work, blocked countries. Any change to `shared/config.ts`, moderation,
  retention, entry fields or features updates the affected answers in the same change.
- Verify Cloudflare and library APIs against current docs before writing setup code.

## Stack

All on Cloudflare, chosen for minimal ops and low cost:

- **Workers**: HTTP endpoints (TypeScript)
- **Durable Objects**: WebSockets and live state. One lobby DO for presence and the
  online list (filter and paginate server-side), one DO per 1-on-1 chat. WebSocket hibernation.
- **D1**: bans, reports and encrypted retention records
- **R2**: the 1-year message archive (gzip + AES-GCM bundles, one D1 index row per bundle)
- **KV**: fast ban lookups
- **Static assets**: React + Vite + Tailwind frontend, mobile-first
- **Turnstile**: invisible/managed bot check on the entry screen only (once per session), backed
  by rate limits and spam signals, all values in one config file (`shared/config.ts`):
  5 msgs / 5s per chat; 10 new chats / min; same text (10+ chars) to 5+ users / min blocked;
  1,000 chars per message; entries 5 / 10 min per device and 30 / 10 min per network (IPv4
  address or IPv6 /64, since mobile users share IPs); 10 reports / hour per device; 20
  typing/seen signals / 10s per user (extras dropped silently).
  Rate-limit/spam hit → "slow down" notice (strike); 3 strikes / 10 min → kicked; 3 kicks / 24h
  → ban. Filter rejections (links, swearing) are not strikes.
- **Local dev**: Vite + Cloudflare Vite plugin (`workerd` runs locally, offline).
  Tests use Vitest with the Workers pool.

## Frontend & look

- React + Vite, Tailwind, shadcn/ui (on Radix). No SSR; landing/terms/privacy are plain static
  HTML for SEO.
- Modern, minimalist, cosy 1-on-1 feel. Light and dark mode, following the device setting live;
  a manual toggle overrides it, remembered on the device only.
- Pink → violet gradient (`#DB2777` → `#7C3AED`) on buttons, own chat bubbles, badges and logo
  only. Rest stays neutral.
- Users shown as letter tiles (no avatars). Tap targets ≥ 44px. Font Plus Jakarta Sans,
  self-hosted.
- Ad slots exist in the layout but render nothing while ads are off.

## Writing style

- **No em dashes** anywhere: docs, code comments, commit messages, UI copy. Use a colon, comma,
  semicolon, period or parentheses instead. An en dash (–) is only for number ranges (18–99).

## Git conventions

- [Conventional Commits](https://www.conventionalcommits.org/):
  `<type>(<optional scope>): <subject>`. Scopes: `worker`, `lobby`, `chat`, `moderation`, `web`,
  `entry`, `shared`, `legal`, `admin`, `deploy`.
- Subject in imperative mood, lower case, no trailing period, ≤ 72 characters. Body explains why.
- One logical change per commit. `main` is always deployable.
- Never commit secrets, `.dev.vars*`, `.env*` with real keys, `node_modules`, `dist`, `.wrangler`.

## Core principles

- **No accounts.** Nickname only. No email, no password, no registration.
- **Ephemeral for users, retained only as the law requires.** Users never see saved history:
  chats vanish when they end and profiles vanish when the user leaves. To follow Philippine law
  (RA 11930), the system keeps, encrypted and owner-only: connection and chat records (who, with
  whom, when, IP, nickname) for 6 months, and the messages of all chats for 1 year, as
  compressed, encrypted bundles in R2. Reported and taken-down chats keep a snapshot for 1 year.
- **18+ only.** Entry requires an 18+ confirmation, backed by the terms. No real age
  verification.
- **Mobile-first.** No native app.
- **Ad-ready layout.** Slots reserved in the online list and the empty desktop chat area, never
  on or beside a chat.

## Feature scope

| Feature | Notes |
|---|---|
| Guest entry with nickname | Gender, age, country required; 18+ confirmation |
| Live online-users list | Filter by gender, age, country |
| Public profile | Short bio only, session-only. No avatars or images |
| 1-on-1 private chat | The only chat mode; no public rooms |
| Emojis | A message of only 1–3 emoji shows big, without a bubble |
| New-message alert | Visual only, no sound |
| Typing indicator | Sent at most every 3s, shown for 5s or until their message arrives |
| Seen indicator | "Seen" under your newest message the other person has viewed |
| Rules popup | Shown once after entry; "I agree" closes it |
| Block / report | Report counts only if the reporter chatted with the person and they sent ≥ 1 message. 3 counted reports in 24h from 3 different devices and 3 different networks → ban. Device ban escalates 1h → 24h → 7 days; network ban is 1h. Reporting also blocks and stores an encrypted snapshot for 1 year |
| One session per device | New tabs reuse the existing session |
| Link filtering | Blocks `http`, `www.`, `name.tld` and "dot com" tricks |

### Details

| Topic | Decision |
|---|---|
| Device ID | Random ID in a signed, HttpOnly cookie |
| Stored personal data | HMAC-hashed device and network ids (6 months). Nickname, IP and message text only inside AES-GCM payloads (key `RETENTION_KEY`), readable only through the admin tools. Live chat text wiped 10 min after the chat ends (24h max); messages archived in batches of 100 (and at chat end) as encrypted R2 bundles kept 1 year |
| Log policy | Never log message text, bios, nicknames, IPs, device ids, cookies or tokens |
| Leaving | Removed ~60s after last tab disconnects, then all data wiped |
| Idle | Kicked after 30 min with no activity |
| Nickname | 3–20 chars, letters/numbers/`_`, unique among online users, profanity filter |
| Profanity | One English filter for nicknames, bios and messages, incl. tricks like spaced letters |
| Contact details | Phone numbers, emails and social handles blocked in nicknames, bios and messages (keeps chats on-platform). 3 blocked attempts in 10 min = 1 strike |
| Gender / age / country | Male, Female, Other / 18–99 / full list pre-selected from `request.cf.country` |
| Bio | Optional, 150 chars, same filters as messages |
| Report reasons | Spam, harassment, underage, sexual content, other. All count the same |
| Country availability | `BLOCKED_COUNTRIES = ["GB","AU","ID"]` → "not available in your country yet" page |
| Admin | Owner-only page `/s-admin` behind Cloudflare Access: lookups, takedowns, holds, activity log, CSV/PDF case files; CLI tools as backup |
| Analytics | Cloudflare Web Analytics only (cookie-free) |

### Out of scope

Registered accounts, captcha by default, friends list, public rooms, voice messages, message
sounds, user-visible saved history, premium tier, native app, photo sharing.
