import { AccessAuth } from "./admin/accessAuth";
import { AdminAuth } from "./admin/adminAuth";
import { AuditLog } from "./admin/auditLog";
import type { BotCheck } from "./botcheck/BotCheck";
import { TurnstileBotCheck } from "./botcheck/TurnstileBotCheck";
import { Alerts, EmailAlertSender, type AlertSender } from "./health/alerts";
import { JobRunStore } from "./health/jobRuns";
import { DeviceCookies } from "./http/deviceCookie";
import { BanStore } from "./moderation/banStore";
import { IdentityHasher } from "./moderation/identityHash";
import { ReportStore } from "./moderation/reportStore";
import { ContentArchive } from "./retention/ContentArchive";
import { Encryptor } from "./retention/Encryptor";
import { RetentionStore } from "./retention/RetentionStore";

export interface AppDeps {
  access: AccessAuth | null;
  admin: AdminAuth | null;
  alerts: Alerts;
  audit: AuditLog;
  now: () => number;
  botCheck: BotCheck;
  bans: BanStore;
  cookies: DeviceCookies;
  hasher: IdentityHasher;
  jobs: JobRunStore;
  reports: ReportStore;
  retention: RetentionStore;
}

const ENTRY_ACTION = "enter";

function commaList(value: string | undefined): string[] {
  return (value ?? "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

export function devAdminEmail(env: Env): string | null {
  return env.DEV_INSECURE_COOKIES === "1" && env.ADMIN_DEV_EMAIL ? env.ADMIN_DEV_EMAIL : null;
}

function accessFromEnv(env: Env): AccessAuth | null {
  const teamDomain = env.ACCESS_TEAM_DOMAIN;
  const audience = env.ACCESS_AUD;
  const emails = commaList(env.ADMIN_EMAILS);
  if (!teamDomain && !audience && emails.length === 0) return null;
  try {
    return new AccessAuth({ teamDomain, audience, emails, devEmail: devAdminEmail(env) });
  } catch {
    console.error("admin_access_misconfigured");
    return null;
  }
}

function alertSenderFromEnv(env: Env): AlertSender | null {
  const from = env.ALERT_EMAIL_FROM;
  const to = env.ALERT_EMAIL_TO;
  if (!from && !to) return null;
  try {
    return new EmailAlertSender(env.ALERTS, from, to);
  } catch {
    console.error("alert_email_misconfigured");
    return null;
  }
}

export function createDeps(env: Env, now: () => number = () => Date.now()): AppDeps {
  const expectedHostnames = commaList(env.TURNSTILE_HOSTNAMES);
  const hasher = new IdentityHasher(env.IDENTITY_HASH_SECRET);
  const retentionEncryptor = new Encryptor(env.RETENTION_KEY);
  return {
    access: accessFromEnv(env),
    admin: env.ADMIN_TOKEN ? new AdminAuth(env.ADMIN_TOKEN) : null,
    alerts: new Alerts(env.DB, alertSenderFromEnv(env), now),
    audit: new AuditLog(env.DB, now),
    now,
    botCheck: new TurnstileBotCheck({
      secret: env.TURNSTILE_SECRET,
      expectedHostnames,
      expectedAction: expectedHostnames.length > 0 ? ENTRY_ACTION : null,
    }),
    bans: new BanStore(env.BANS, env.DB, now),
    cookies: new DeviceCookies(commaList(env.COOKIE_SECRETS), env.DEV_INSECURE_COOKIES !== "1"),
    hasher,
    jobs: new JobRunStore(env.DB),
    reports: new ReportStore(env.DB),
    retention: new RetentionStore(
      env.DB,
      retentionEncryptor,
      hasher,
      now,
      env.RETAIN_ALL_CONTENT === "true",
      new ContentArchive(env.DB, env.ARCHIVE, retentionEncryptor, now),
    ),
  };
}

const depsByEnv = new WeakMap<Env, AppDeps>();

export function depsFor(env: Env): AppDeps {
  let deps = depsByEnv.get(env);
  if (!deps) {
    deps = createDeps(env);
    depsByEnv.set(env, deps);
  }
  return deps;
}
