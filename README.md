# Swoony

An anonymous 1-on-1 chat site for adults. No sign-up: pick a nickname, see who's online, start
chatting. Chats vanish when they end.

> **Status: showcase project.** Fully built and tested, never launched. Kept here to show the
> architecture, the moderation design and how the build was run.

## What it does

- **Nickname-only entry** with gender, age, country and an 18+ confirmation
- **Live online list** with filters (gender, age, country), paginated on the server
- **Private 1-on-1 chat** with typing and "seen" indicators, big emoji, no sounds
- **Automatic moderation**: link, contact-detail and profanity filters, rate limits, strikes,
  kicks and bans, block and report (3 reports from 3 devices and 3 networks = ban)
- **Bot check** with Cloudflare Turnstile, once per session
- **One session per device**: new tabs reuse the same identity
- **Legal retention** built in: encrypted connection records and message archives (Philippine
  law, RA 11930), readable only through an owner admin console
- **Admin console** at `/s-admin`: search, takedowns, case files as CSV/PDF, activity log
- Light and dark mode, mobile first, ad slots reserved but empty

## Stack

| Layer | Tech |
|---|---|
| Frontend | React 19, Vite, Tailwind 4, shadcn/ui (Radix), Zustand |
| Backend | Cloudflare Workers (TypeScript) |
| Live state | Durable Objects with WebSocket hibernation: one lobby, one per chat |
| Data | D1 (bans, reports, records), KV (fast ban lookup), R2 (encrypted archives) |
| Security | Turnstile, signed HttpOnly device cookie, HMAC-hashed ids, AES-GCM |
| Admin sign-in | Cloudflare Access |
| Tests | Vitest (Workers pool for backend, jsdom for frontend) |

## Run it locally

Needs Node 22+. Runs fully offline (`workerd` runs locally).

```sh
npm install
cp .dev.vars.example .dev.vars
npx wrangler d1 migrations apply swoony --local
npm run dev
```

Open http://localhost:5173. Admin is at http://localhost:5173/s-admin (no sign-in locally).
The dev keys in `.dev.vars.example` and `.env.development` are test values only.

| Command | What it does |
|---|---|
| `npm run dev` | Site and backend locally |
| `npm run check` | Types, lint, format and all tests |
| `npm run test:web` / `test:worker` | Frontend or backend tests only |
| `npm run build` | Production build |
| `node scripts/loadtest.ts --users 1000` | Load test against the dev server |

Deploying to your own Cloudflare account: [docs/deployment.md](docs/deployment.md).

## How it's built

```
src/       React app (entry, online list, chat, admin)
worker/    Worker routes, Lobby and ChatRoom Durable Objects, moderation, retention
shared/    Config, wire protocol and text filters used by both sides
migrations/  D1 schema
```

- **Lobby DO** holds presence, the online list and per-user abuse counters. **ChatRoom DO**
  holds one conversation. Both hibernate, so idle sockets cost nothing.
- **All limits live in one file**, [shared/config.ts](shared/config.ts), so tuning never
  touches logic.
- **The same filters run on both sides**: the client warns early, the server enforces.
- **No personal data in plain text**: device and network ids are HMAC-hashed; nicknames, IPs
  and messages are only stored inside AES-GCM payloads.

## How I built it

Built with Claude Code as the pair programmer, run like a small team project:

1. **Spec first.** Product rules and decisions in [CLAUDE.md](CLAUDE.md), legal research
   before any backend code.
2. **Plan, then tasks.** [docs/plan.md](docs/plan.md) broken into small, testable tasks.
3. **One task at a time:** tests first (TDD), `npm run check`, code review, a security review
   on sensitive tasks, then my review before each commit.
4. **Docs kept in sync** with every change, including a visual guide
   ([docs/visual-guide.html](docs/visual-guide.html)).

Around 85 test files and 43k lines of TypeScript.

## What I learned

- **Durable Objects fit chat well.** One object per room gives you ordering and state for free;
  hibernation keeps it cheap.
- **Moderation is most of the work** in anonymous chat. Filters get dodged ("f u c k",
  "dot com"), so rules need strikes and escalation, not just blocking.
- **Reports need guards.** Only counting reports from real chat partners, across different
  devices and networks, stops one person from banning others.
- **Shared IPs are real.** Mobile users share addresses, so network limits must be looser than
  device limits, and IPv6 is grouped by /64.
- **"Anonymous" and "legal" pull apart.** Local law required keeping records, which shaped the
  whole data design: encrypt everything, hash ids, owner-only access.
- **A written plan beats prompting on the fly.** Small, reviewed tasks with tests kept AI-written
  code consistent across a large codebase.
- **Why not launch:** running a real anonymous chat means 24h takedowns, legal reports and
  constant abuse handling. Fine to build, a lot to operate alone.

## Docs

| Doc | For |
|---|---|
| [CLAUDE.md](CLAUDE.md) | Product rules and decisions |
| [docs/plan.md](docs/plan.md) | Technical build plan |
| [docs/admin-plan.md](docs/admin-plan.md) | Admin console design |
| [docs/deployment.md](docs/deployment.md) | Deploying and running in production |
| [docs/visual-guide.html](docs/visual-guide.html) | Visual walkthrough of pages, chat flow and admin |

## License

[MIT](LICENSE)
