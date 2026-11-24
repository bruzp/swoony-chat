import { LIMITS } from "@shared/config";
import type { SystemHealth } from "@shared/protocol/admin";
import { env } from "cloudflare:workers";
import { beforeEach, expect, it, vi } from "vitest";
import { handleRequest } from "../app";
import type { AppDeps } from "../deps";
import { adminDeps, webAdminCall } from "../test/adminAccess";
import { deps, ORIGIN, resetLobby, uniqueIp } from "../test/helpers";
import { Alerts, type AlertSender } from "./alerts";
import { runDailyCleanup } from "./cleanup";

const DAY = 86_400_000;

beforeEach(async () => {
  await resetLobby();
  await env.DB.batch([
    env.DB.prepare("DELETE FROM job_runs"),
    env.DB.prepare("DELETE FROM alert_log"),
  ]);
});

function fakeSender(): AlertSender & { sent: { subject: string; text: string }[] } {
  const sent: { subject: string; text: string }[] = [];
  return {
    sent,
    send(subject, text) {
      sent.push({ subject, text });
      return Promise.resolve();
    },
  };
}

function withSender(sender: AlertSender, now = () => Date.now()): AppDeps {
  return { ...deps, now, alerts: new Alerts(env.DB, sender, now) };
}

function health(appEnv: Env = env, appDeps: AppDeps = deps, ip = uniqueIp()): Promise<Response> {
  return handleRequest(
    new Request(`${ORIGIN}/api/health`, { headers: { "CF-Connecting-IP": ip } }),
    appEnv,
    appDeps,
  );
}

const brokenDb = {
  prepare() {
    throw new Error("D1 is down with secret detail");
  },
} as unknown as D1Database;

it("answers ok with nothing but the status", async () => {
  const res = await health();
  expect(res.status).toBe(200);
  expect(await res.json()).toEqual({ status: "ok" });
  expect(res.headers.get("Cache-Control")).toBe("no-store");
});

it("answers down without details when the database fails", async () => {
  const res = await health({ ...env, DB: brokenDb });
  expect(res.status).toBe(503);
  const text = await res.text();
  expect(JSON.parse(text)).toEqual({ status: "down" });
  expect(text).not.toContain("secret");
});

it("answers down when the ban store fails", async () => {
  const brokenKv = {
    get: () => Promise.reject(new Error("kv down")),
  } as unknown as KVNamespace;
  expect((await health({ ...env, BANS: brokenKv })).status).toBe(503);
});

it("has its own small rate limit per network", async () => {
  const ip = uniqueIp();
  for (let i = 0; i < LIMITS.healthChecksPerNetwork.count; i++) {
    expect((await health(env, deps, ip)).status).toBe(200);
  }
  expect((await health(env, deps, ip)).status).toBe(429);
  expect((await health()).status).toBe(200);
});

it("records a successful cleanup run with rows deleted per table", async () => {
  await runDailyCleanup(env, deps, Date.now());
  const row = await env.DB.prepare("SELECT * FROM job_runs").first<{
    job: string;
    ok: number;
    finished_at: number | null;
    deleted_counts: string;
    error_code: string | null;
  }>();
  expect(row).toMatchObject({ job: "daily_cleanup", ok: 1, error_code: null });
  expect(row?.finished_at).not.toBeNull();
  const deleted = JSON.parse(row?.deleted_counts ?? "{}") as Record<string, number>;
  expect(Object.keys(deleted)).toEqual(
    expect.arrayContaining([
      "reports",
      "bans",
      "connection_log",
      "content_log",
      "content_archive",
      "admin_audit",
    ]),
  );
});

it("records a failed run with a fixed code and emails once per 6 hours", async () => {
  const sender = fakeSender();
  let clock = Date.now();
  const failing: AppDeps = {
    ...withSender(sender, () => clock),
    retention: Object.assign(Object.create(deps.retention) as AppDeps["retention"], {
      purgeExpired: () => Promise.reject(new Error("boom with user data")),
    }),
  };
  await expect(runDailyCleanup(env, failing, clock)).rejects.toThrow();
  const row = await env.DB.prepare("SELECT ok, error_code FROM job_runs").first();
  expect(row).toEqual({ ok: 0, error_code: "retention_purge_failed" });
  expect(sender.sent).toHaveLength(1);
  expect(JSON.stringify(sender.sent)).not.toContain("user data");

  clock += 60 * 60 * 1000;
  await expect(runDailyCleanup(env, failing, clock)).rejects.toThrow();
  expect(sender.sent).toHaveLength(1);
  clock += LIMITS.alertRepeatMs;
  await expect(runDailyCleanup(env, failing, clock)).rejects.toThrow();
  expect(sender.sent).toHaveLength(2);
});

it("still runs the other purges when one fails", async () => {
  const now = Date.now();
  const ancient = now - LIMITS.adminAuditRetentionMs - DAY;
  await env.DB.prepare("DELETE FROM admin_audit").run();
  await env.DB.prepare(
    "INSERT INTO admin_audit (at, actor, action, result, prev_hash) VALUES (?, 'x', 'lookup', 'ok', ?)",
  )
    .bind(ancient, "0".repeat(64))
    .run();
  const failing: AppDeps = {
    ...withSender(fakeSender(), () => now),
    retention: Object.assign(Object.create(deps.retention) as AppDeps["retention"], {
      purgeExpired: () => Promise.reject(new Error("boom")),
    }),
  };
  await expect(runDailyCleanup(env, failing, now)).rejects.toThrow();
  const actions = await env.DB.prepare("SELECT action FROM admin_audit").all();
  expect(actions.results).toEqual([{ action: "checkpoint" }]);
  expect(await env.DB.prepare("SELECT error_code FROM job_runs").first("error_code")).toBe(
    "retention_purge_failed",
  );
});

it("emails when no cleanup has succeeded for 26 hours", async () => {
  const sender = fakeSender();
  const now = Date.now();
  await env.DB.prepare(
    "INSERT INTO job_runs (job, started_at, finished_at, ok) VALUES ('daily_cleanup', ?1, ?1, 1)",
  )
    .bind(now - LIMITS.cleanupStaleMs - 1)
    .run();
  const appDeps = withSender(sender, () => now);
  expect((await health(env, appDeps)).status).toBe(200);
  await health(env, appDeps);
  expect(sender.sent).toHaveLength(1);
  expect(sender.sent[0]?.subject).toMatch(/clean-up/i);
});

it("answers even when the alert email hangs", async () => {
  const now = Date.now();
  await env.DB.prepare(
    "INSERT INTO job_runs (job, started_at, finished_at, ok) VALUES ('daily_cleanup', ?1, ?1, 1)",
  )
    .bind(now - LIMITS.cleanupStaleMs - 1)
    .run();
  const hanging: AlertSender = { send: () => new Promise(() => undefined) };
  const started = Date.now();
  const res = await health(
    env,
    withSender(hanging, () => now),
  );
  expect(res.status).toBe(200);
  expect(Date.now() - started).toBeLessThan(LIMITS.healthCheckTimeoutMs + 1_000);
}, 10_000);

it("purges job history older than 90 days", async () => {
  const now = Date.now();
  await env.DB.prepare(
    "INSERT INTO job_runs (job, started_at, finished_at, ok) VALUES ('daily_cleanup', ?1, ?1, 1)",
  )
    .bind(now - 91 * DAY)
    .run();
  await runDailyCleanup(env, deps, now);
  const { n } = (await env.DB.prepare("SELECT COUNT(*) AS n FROM job_runs").first<{
    n: number;
  }>()) ?? { n: -1 };
  expect(n).toBe(1);
});

it("shows the admin a detailed health page", async () => {
  await runDailyCleanup(env, deps, Date.now());
  const res = await webAdminCall("health", {}, { appDeps: adminDeps });
  expect(res.status).toBe(200);
  const page = await res.json<SystemHealth>();
  expect(page.components.map((c) => [c.name, c.ok])).toEqual([
    ["site", true],
    ["database", true],
    ["banStore", true],
    ["lobby", true],
  ]);
  expect(page.online).toBe(0);
  expect(page.maintenance).toBe(false);
  expect(page.cleanupStale).toBe(false);
  expect(page.lastRuns).toHaveLength(1);
  expect(page.lastRuns[0]).toMatchObject({ job: "daily_cleanup", ok: true });
});

it("the scheduled handler runs the tracked cleanup", async () => {
  const spy = vi.spyOn(console, "error").mockImplementation(() => undefined);
  const worker = (await import("../index")).default;
  const { createScheduledController } = await import("cloudflare:test");
  await worker.scheduled(createScheduledController({ cron: "0 3 * * *" }), env);
  const row = await env.DB.prepare("SELECT ok FROM job_runs").first();
  expect(row).toEqual({ ok: 1 });
  spy.mockRestore();
});
