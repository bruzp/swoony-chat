import type { AuditPage } from "@shared/protocol/admin";
import { createScheduledController } from "cloudflare:test";
import { env } from "cloudflare:workers";
import { beforeEach, expect, it, vi } from "vitest";
import { handleRequest } from "../app";
import { RetentionStore } from "../retention/RetentionStore";
import worker from "../index";
import { ADMIN_EMAIL, webAdminCall } from "../test/adminAccess";
import {
  deps,
  enter,
  openPairChat,
  ORIGIN,
  resetLobby,
  uniqueIp,
  uniqueName,
} from "../test/helpers";

beforeEach(async () => {
  await resetLobby();
  await env.DB.prepare("DELETE FROM admin_audit").run();
});

const FAR_FUTURE = 8_640_000_000_000_000;
const WINDOW = { from: 0, to: FAR_FUTURE };
const CASE = "PNP-ACG-77";

async function auditRows(): Promise<Record<string, unknown>[]> {
  const { results } = await env.DB.prepare("SELECT * FROM admin_audit ORDER BY id").all();
  return results;
}

it("writes exactly one row per search, ban, takedown and hold", async () => {
  const { a, ca, cb, chatId } = await openPairChat();
  ca.send({ type: "send", clientId: "1", text: "hi" });
  await cb.next("message");
  await webAdminCall("lookup", { caseRef: CASE, userId: a.me.userId, ...WINDOW });
  await webAdminCall("hold", { caseRef: CASE, chatId, until: FAR_FUTURE });
  await webAdminCall("takedown", { caseRef: CASE, chatId });
  await webAdminCall("ban", { caseRef: CASE, userId: a.me.userId });
  const rows = await auditRows();
  expect(rows.map((row) => row.action)).toEqual(["lookup", "hold", "takedown", "ban"]);
  expect(rows.every((row) => row.case_ref === CASE && row.actor === ADMIN_EMAIL)).toBe(true);
  expect(rows[0]).toMatchObject({
    target_kind: "user",
    target_hash: await deps.hasher.hash(a.me.userId),
    result: "ok",
    admin_country: "PH",
  });
  expect(rows[0]?.result_count).toBeGreaterThan(0);
});

it("records a missing record as its result", async () => {
  await webAdminCall("ban", { caseRef: CASE, userId: "nobody" });
  expect(await auditRows()).toMatchObject([{ action: "ban", result: "no_record" }]);
});

it("writes no row when validation fails or the call is refused", async () => {
  await webAdminCall("lookup", { caseRef: CASE, from: "x" });
  await webAdminCall("lookup", { caseRef: "x", userId: "u", ...WINDOW });
  await webAdminCall("lookup", { caseRef: CASE, userId: "u", ...WINDOW }, { token: null });
  await webAdminCall("holds");
  expect(await auditRows()).toEqual([]);
});

it("never stores a nickname, IP or message text", async () => {
  const nickname = uniqueName("Secret");
  const ip = uniqueIp();
  const { me } = await enter({ nickname }, { ip });
  const { ca, cb, chatId } = await openPairChat();
  ca.send({ type: "send", clientId: "1", text: "very private words" });
  await cb.next("message");
  await webAdminCall("lookup", { caseRef: CASE, nickname, ...WINDOW }, { ip });
  await webAdminCall("takedown", { caseRef: CASE, chatId }, { ip });
  await webAdminCall("ban", { caseRef: CASE, userId: me.userId }, { ip });
  const stored = JSON.stringify(await auditRows());
  expect(stored).not.toContain(nickname);
  expect(stored.toLowerCase()).not.toContain(nickname.toLowerCase());
  expect(stored).not.toContain(ip);
  expect(stored).not.toContain("very private words");
  expect(stored).not.toContain(me.userId);
});

it("records CLI actions too, without a case reference", async () => {
  await handleRequest(
    new Request(`${ORIGIN}/api/admin/lookup`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${env.ADMIN_TOKEN}`,
        "CF-Connecting-IP": uniqueIp(),
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ userId: "someone", ...WINDOW }),
    }),
    env,
    deps,
  );
  expect(await auditRows()).toMatchObject([{ actor: "cli", action: "lookup", case_ref: null }]);
});

it("shows the activity log with the chain status", async () => {
  await webAdminCall("lookup", { caseRef: CASE, userId: "u1", ...WINDOW });
  await webAdminCall("lookup", { caseRef: CASE, userId: "u2", ...WINDOW });
  const res = await webAdminCall("audit", {});
  expect(res.status).toBe(200);
  const page = await res.json<AuditPage>();
  expect(page.rows).toHaveLength(2);
  expect(page.rows[0]?.id).toBeGreaterThan(page.rows[1]?.id ?? Infinity);
  expect(page.chain).toEqual({ intact: true, checked: 2, brokenAt: null, complete: true });
  const older = await (await webAdminCall("audit", { before: page.rows[0]?.id })).json<AuditPage>();
  expect(older.rows).toHaveLength(1);
  expect(older.chain).toBeNull();
  expect((await webAdminCall("audit", { before: "x" })).status).toBe(400);
});

it("the daily cleanup purges year-old activity rows", async () => {
  await env.DB.prepare(
    "INSERT INTO admin_audit (at, actor, action, result, prev_hash) VALUES (1, 'x', 'lookup', 'ok', ?)",
  )
    .bind("0".repeat(64))
    .run();
  await worker.scheduled(createScheduledController({ cron: "0 3 * * *" }), env);
  expect((await auditRows()).map((row) => row.action)).toEqual(["checkpoint"]);
});

it("the daily cleanup keeps old activity for every held case, not just the first page of holds", async () => {
  const chatId = "h".repeat(64);
  await deps.retention.logChatStart(chatId, "held-a", "held-b", Date.now());
  await deps.retention.setHold({ chatId }, FAR_FUTURE);
  await env.DB.prepare(
    "INSERT INTO admin_audit (at, actor, action, result, prev_hash, target_kind, target_hash) VALUES (1, 'x', 'hold', 'ok', ?, 'chat', ?)",
  )
    .bind("0".repeat(64), await deps.hasher.hash(chatId))
    .run();
  const holdsPage = vi.spyOn(RetentionStore.prototype, "activeHolds").mockResolvedValue([]);
  try {
    await worker.scheduled(createScheduledController({ cron: "0 3 * * *" }), env);
  } finally {
    holdsPage.mockRestore();
  }
  expect((await auditRows()).map((row) => row.action)).toContain("hold");
});
