import { LIMITS } from "@shared/config";
import { createScheduledController } from "cloudflare:test";
import { env } from "cloudflare:workers";
import { expect, it } from "vitest";
import worker from "../index";
import { purgeExpired } from "./retention";

const NOW = 100_000_000_000;
const OLD = NOW - LIMITS.moderationRetentionMs - 1;
const FRESH = NOW - LIMITS.moderationRetentionMs + 1_000;

async function insertReport(device: string, createdAt: number): Promise<void> {
  await env.DB.prepare(
    "INSERT INTO reports (reported_device, source, reason, created_at) VALUES (?, 'system', 'kick', ?)",
  )
    .bind(device, createdAt)
    .run();
}

async function insertBan(device: string, deviceExpiresAt: number, networkExpiresAt: number) {
  await env.DB.prepare(
    `INSERT INTO bans (device_hash, network_hash, level, starts_at, device_expires_at, network_expires_at)
     VALUES (?, 'net', 0, 0, ?, ?)`,
  )
    .bind(device, deviceExpiresAt, networkExpiresAt)
    .run();
}

async function countFor(table: "reports" | "bans" | "content_log", column: string, value: string) {
  const row = await env.DB.prepare(`SELECT COUNT(*) AS n FROM ${table} WHERE ${column} = ?`)
    .bind(value)
    .first<{ n: number }>();
  return row?.n ?? 0;
}

it("purgeExpired removes old reports and long-expired bans only", async () => {
  const tag = crypto.randomUUID();
  await insertReport(`old-${tag}`, OLD);
  await insertReport(`fresh-${tag}`, FRESH);
  await insertBan(`old-${tag}`, OLD, OLD);
  await insertBan(`device-${tag}`, FRESH, OLD);
  await insertBan(`network-${tag}`, OLD, FRESH);
  await purgeExpired(env.DB, NOW);
  expect(await countFor("reports", "reported_device", `old-${tag}`)).toBe(0);
  expect(await countFor("reports", "reported_device", `fresh-${tag}`)).toBe(1);
  expect(await countFor("bans", "device_hash", `old-${tag}`)).toBe(0);
  expect(await countFor("bans", "device_hash", `device-${tag}`)).toBe(1);
  expect(await countFor("bans", "device_hash", `network-${tag}`)).toBe(1);
});

it("the scheduled handler purges moderation and retention records", async () => {
  const tag = crypto.randomUUID();
  const ancient = Date.now() - LIMITS.reportedContentRetentionMs - 1;
  await insertReport(`cron-${tag}`, ancient);
  await env.DB.prepare(
    "INSERT INTO content_log (chat_id, kind, payload, created_at) VALUES (?, 'report_snapshot', 'x', ?)",
  )
    .bind(`cron-${tag}`, ancient)
    .run();
  await worker.scheduled(createScheduledController({ cron: "0 3 * * *" }), env);
  expect(await countFor("reports", "reported_device", `cron-${tag}`)).toBe(0);
  expect(await countFor("content_log", "chat_id", `cron-${tag}`)).toBe(0);
});
