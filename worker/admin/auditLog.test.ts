import { LIMITS } from "@shared/config";
import { env } from "cloudflare:workers";
import { beforeEach, expect, it } from "vitest";
import { AuditLog, type AuditEntry } from "./auditLog";

const NOW = 1_800_000_000_000;
let clock = NOW;
const log = new AuditLog(env.DB, () => clock);

beforeEach(async () => {
  clock = NOW;
  await env.DB.prepare("DELETE FROM admin_audit").run();
});

function entry(overrides: Partial<AuditEntry> = {}): AuditEntry {
  return {
    actor: "owner@example.com",
    action: "lookup",
    caseRef: "NBI-1",
    targetKind: "user",
    targetHash: "a".repeat(64),
    result: "ok",
    resultCount: 2,
    exportSha256: null,
    adminNetworkHash: "b".repeat(64),
    adminCountry: "PH",
    ...overrides,
  };
}

it("appends rows that chain to each other", async () => {
  await log.record(entry());
  await log.record(entry({ action: "ban" }));
  await log.record(entry({ action: "hold" }));
  expect(await log.verify()).toEqual({ intact: true, checked: 3, brokenAt: null, complete: true });
});

it("says when the check stopped at its row cap instead of claiming the whole chain", async () => {
  for (let i = 0; i < 3; i++) await log.record(entry({ resultCount: i }));
  expect(await log.verify(2)).toEqual({
    intact: true,
    checked: 2,
    brokenAt: null,
    complete: false,
  });
});

it("keeps a straight chain when rows are written at the same time", async () => {
  await Promise.all(Array.from({ length: 5 }, (_, i) => log.record(entry({ resultCount: i }))));
  const { results } = await env.DB.prepare(
    "SELECT COUNT(DISTINCT prev_hash) AS n FROM admin_audit",
  ).all<{ n: number }>();
  expect(results[0]?.n).toBe(5);
  expect((await log.verify()).intact).toBe(true);
});

it("shows where an edited row breaks the chain", async () => {
  for (let i = 0; i < 4; i++) await log.record(entry({ resultCount: i }));
  const { results } = await env.DB.prepare("SELECT id FROM admin_audit ORDER BY id").all<{
    id: number;
  }>();
  const second = results[1]?.id ?? 0;
  await env.DB.prepare("UPDATE admin_audit SET case_ref = 'EDITED' WHERE id = ?")
    .bind(second)
    .run();
  expect(await log.verify()).toMatchObject({ intact: false, brokenAt: results[2]?.id });
});

it("shows where a deleted row breaks the chain", async () => {
  for (let i = 0; i < 4; i++) await log.record(entry({ resultCount: i }));
  const { results } = await env.DB.prepare("SELECT id FROM admin_audit ORDER BY id").all<{
    id: number;
  }>();
  await env.DB.prepare("DELETE FROM admin_audit WHERE id = ?")
    .bind(results[1]?.id ?? 0)
    .run();
  expect(await log.verify()).toMatchObject({ intact: false, brokenAt: results[2]?.id });
  await env.DB.prepare("DELETE FROM admin_audit WHERE id = ?")
    .bind(results[0]?.id ?? 0)
    .run();
  expect((await log.verify()).intact).toBe(false);
});

it("purges rows older than a year and still verifies from a checkpoint", async () => {
  await log.record(entry({ resultCount: 1 }));
  await log.record(entry({ resultCount: 2 }));
  clock = NOW + LIMITS.adminAuditRetentionMs + 1;
  await log.record(entry({ resultCount: 3 }));
  await log.purge(clock, new Set());
  const rows = await log.list({});
  expect(rows.map((row) => row.action)).toEqual(["checkpoint", "lookup"]);
  expect(rows[1]?.resultCount).toBe(3);
  expect(await log.verify()).toEqual({ intact: true, checked: 2, brokenAt: null, complete: true });
  await log.record(entry({ resultCount: 4 }));
  clock += LIMITS.adminAuditRetentionMs + 1;
  await log.record(entry({ resultCount: 5 }));
  await log.purge(clock, new Set());
  expect(await log.verify()).toMatchObject({ intact: true });
});

it("keeps old rows tied to a record under hold", async () => {
  const held = "c".repeat(64);
  await log.record(entry({ targetHash: "d".repeat(64) }));
  await log.record(entry({ targetHash: held }));
  await log.record(entry({ targetHash: "e".repeat(64) }));
  clock = NOW + LIMITS.adminAuditRetentionMs + 1;
  await log.purge(clock, new Set([held]));
  const kept = (await log.list({})).map((row) => row.targetHash);
  expect(kept).toContain(held);
  expect(kept).not.toContain("d".repeat(64));
  expect((await log.verify()).intact).toBe(true);
});

it("does nothing when no row is old enough", async () => {
  await log.record(entry());
  await log.purge(clock, new Set());
  expect((await log.list({})).map((row) => row.action)).toEqual(["lookup"]);
});

it("lists newest first in pages", async () => {
  for (let i = 0; i < 3; i++) await log.record(entry({ resultCount: i }));
  const [newest, ...rest] = await log.list({ limit: 2 });
  expect(newest?.resultCount).toBe(2);
  expect(rest).toHaveLength(1);
  const older = await log.list({ before: rest[0]?.id ?? 0 });
  expect(older.map((row) => row.resultCount)).toEqual([0]);
});
