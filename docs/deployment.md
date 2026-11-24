# Deploying Swoony

The owner's guide to putting Swoony on `swoony.chat` and keeping it running. Do these in order the
first time; later deploys only need "Every deploy" at the
end. Deploy only from `main`, and only after NPC registration.

## 1. Accounts and domain

1. Create a Cloudflare account and choose **Workers Paid** (about $5/month).
2. Buy `swoony.chat` (Cloudflare Registrar is easiest), or point its nameservers to Cloudflare.
3. Log in from your computer: `npx wrangler login`.
4. Turn on billing and usage notifications in the dashboard.

## 2. Database and ban store

```powershell
npx wrangler d1 create swoony
npx wrangler kv namespace create BANS
npx wrangler r2 bucket create swoony-archive
```

Paste the printed ids into `wrangler.jsonc` (`database_id` under `d1_databases`, `id` under
`kv_namespaces`), then create the tables:

```powershell
npx wrangler d1 migrations apply swoony --remote
```

Run the same command again whenever a new file appears in `migrations/` (for example `0004` and
`0005` from the admin console, `0006` indexes from the 2026-11-20 review, `0007` the message
archive index).

The R2 bucket holds every chat's messages for 1 year as encrypted bundles (`RETAIN_ALL_CONTENT` is
`"true"` in `wrangler.jsonc`). It needs no id pasted; the binding uses the bucket name. Never make it
public.

## 3. Admin sign-in (Cloudflare Access)

The admin page `swoony.chat/s-admin` only opens for your email, through Cloudflare Access.

1. In the dashboard open **Zero Trust**, create the organisation (free plan) and note the team
   name (`https://<team>.cloudflareaccess.com`).
2. **Settings, Authentication:** turn on **One-time PIN**.
3. **Access, Applications, Add, Self-hosted:** name it "Swoony admin", add both
   `swoony.chat/s-admin*` and `swoony.chat/api/s-admin/*`, session duration **8 hours**.
4. Policy: **Allow**, Include **Emails** = your email, Require **IP ranges** = your home and phone
   IPs. If your IP changes, add the new one here first.
5. Copy the application's **AUD tag** (Overview tab).

## 4. Alert emails

The Worker emails you when the daily clean-up fails or stops running, and when chat messages have
waited over an hour to be saved to the 1-year archive (R2 or D1 trouble; they keep retrying).

1. **Email, Email Routing** on `swoony.chat`: turn it on. Add your inbox as a **destination
   address** and click the link in the verification email.
2. While there, create `abuse@swoony.chat` forwarding to your inbox.
3. The sender will be `alerts@swoony.chat` (any address on `swoony.chat` works; no mailbox needed).

## 5. Turnstile and analytics

1. **Turnstile:** create a widget in managed mode for hostname `swoony.chat`; copy the site key and
   secret.
2. **Web Analytics:** add a site for `swoony.chat`; copy the token.
3. Put both in `.env.production` (git-ignored; never commit it):

   ```
   VITE_TURNSTILE_SITE_KEY=<site key>
   VITE_CF_ANALYTICS_TOKEN=<token>
   ```

## 6. Secrets

Every secret below is required: `npm run deploy` refuses to run until all are set. Set each with
`npx wrangler secret put <NAME>` and paste the value when asked.

| Secret | Value |
|---|---|
| `COOKIE_SECRETS` | `openssl rand -base64 48` |
| `IDENTITY_HASH_SECRET` | `openssl rand -base64 48` |
| `TURNSTILE_SECRET` | from step 5 |
| `RETENTION_KEY` | `openssl rand -base64 32`. **Keep a copy offline** (password manager). Lose it and the legal records become unreadable |
| `ADMIN_TOKEN` | `openssl rand -base64 48`, for the backup terminal tools; keep a copy in your password manager |
| `ACCESS_TEAM_DOMAIN` | `https://<team>.cloudflareaccess.com` from step 3 |
| `ACCESS_AUD` | the AUD tag from step 3 |
| `ADMIN_EMAILS` | your email (the same one as in the Access policy) |
| `ALERT_EMAIL_FROM` | `alerts@swoony.chat` |
| `ALERT_EMAIL_TO` | your verified inbox from step 4 |

If an admin or alert value is wrong, the public site keeps working; only the admin page or alerts
switch off, and the Worker logs `admin_access_misconfigured` or `alert_email_misconfigured`.

Never set `DEV_INSECURE_COOKIES` or `ALLOW_TEST_RESET` in production.

## 7. Load test

Before the first real deploy, check the app holds 500+ users on real Cloudflare (open item 14 decides
where it runs). Local check, any time:

```powershell
npm run dev
node scripts/loadtest.ts --users 1000
```

Options: `--base <url>`, `--ramp <seconds>`, `--duration <seconds>`. Pass: message round trip p95
under 500 ms and errors under 1%. Last local run (2026-11-20, 1,000 users): p95 127 ms, 0 errors.

## 8. First deploy

```powershell
git checkout main
npm run check
npm run deploy
```

Then in the dashboard attach the custom domain `swoony.chat` to the Worker (or add
`{ "pattern": "swoony.chat", "custom_domain": true }` to `routes` in `wrangler.jsonc`).

**Edge rate limit (flood protection).** The app limits abuse per user, but a flood of plain
requests still reaches the single lobby. Block it at Cloudflare's edge before it costs anything:

1. Dashboard, zone `swoony.chat`, **Security rules**, **Create rule**, **Rate limiting rules**.
2. Name: `API flood`. Expression: `(http.request.uri.path wildcard "/api/*")`.
3. Characteristics: **IP** (preset on the Free plan).
4. Rate: **100 requests per 10 seconds**. Action: **Block** for **10 seconds** (Free plan values;
   on Pro or higher use a 1 minute block).
5. **Deploy.** Keep 100: many Philippine mobile users share one IP, and a normal visit makes only a
   few `/api/` requests. Lower it only if **Security, Events** shows floods getting through.

**Hostname.** Only `swoony.chat` is served. Don't add a `www` record; if you ever do, redirect
it to `swoony.chat` with a Redirect Rule (the cookie, Turnstile hostname and security headers all
assume the bare domain).

**Abuse contact.** In the dashboard, **Manage Account, Configurations**, set the abuse contact
email to `abuse@swoony.chat`. Cloudflare forwards abuse reports about the site there; answer within
24 hours (legal research section 7.4).

## 9. Check it works

1. Open `https://swoony.chat` on two phones and chat.
2. Open `https://swoony.chat/s-admin` in a private window: you see the Cloudflare email-code page.
   Sign in; open **System health**: all four parts show ✅.
3. Open `https://swoony.chat/api/health`: it shows `{"status":"ok"}`.

## 10. Monitoring

1. **Uptime:** at uptimerobot.com (free) add an HTTP monitor for `https://swoony.chat/api/health`
   every 5 minutes, keyword `"status":"ok"`, alerts to your email. It reports "maintenance" (not
   "down") while maintenance mode is on.
2. **Errors:** in the Cloudflare dashboard, **Notifications**: add Workers error-rate and usage
   alerts.
3. **Logs:** run `npx wrangler tail` for a minute while chatting; it must never show message text,
   nicknames or IPs.

4. **Search:** add `swoony.chat` to Google Search Console (DNS check through Cloudflare) to see
   any Safe Browsing or spam flags early.

## If a deploy breaks production

`npx wrangler rollback` returns to the previous code version. It does not undo database migrations:
fix those forward with a new migration.

## Every deploy

1. Merge into `main` only after review.
2. If `migrations/` has a new file: `npx wrangler d1 migrations apply swoony --remote` first.
3. `npm run check`, then `npm run deploy`.
4. Normal deploys need no downtime. Use maintenance mode (runbook section 7) only for risky
   database changes.

## Dependency updates

- Dependabot opens weekly PRs (`.github/dependabot.yml`): patch and minor updates in separate
  groups, majors one by one.
- Patch-only PRs merge themselves after CI passes on the PR. Minor and major PRs wait for you.
- A merge made by the workflow starts no new CI run on `main` (GitHub rule for its own token), so
  always run `npm run check` on `main` before `npm run deploy` (step 3 above).
- Optional: turn on Dependabot alerts in the repo under Settings, Code security.

## Local development

1. Copy `.dev.vars.example` to `.dev.vars` (or add any new lines from it).
2. `npx wrangler d1 migrations apply swoony --local` after new migrations.
3. `npm run dev`, then open `http://localhost:5173`. The admin page
   `http://localhost:5173/s-admin` opens without Access on localhost only, signed in as
   `dev@localhost`. This needs both dev-only settings (`ADMIN_DEV_EMAIL` and
   `DEV_INSECURE_COOKIES=1`), which only the dev server sets.
4. To test on your phone over Wi-Fi: `npm run dev -- --host` and open the "Network" address. In
   this mode the admin page does not sign anyone in automatically (others on the same Wi-Fi could
   reach it); restart without `--host` to use the admin page.
5. If you share the dev server through a Cloudflare tunnel, never add `--http-host-header localhost`
   (or any setting that rewrites the address to `localhost`): that would let anyone on the internet
   into the admin page without signing in.

`.dev.vars` only holds secrets: Wrangler ignores any other line in it. The dev-only settings
(relaxed cookies for phone testing, no Turnstile hostname check, the localhost admin sign-in) are
set by the dev server itself in `vite-plugins/localDevVars.ts`, and never reach a production
build.
