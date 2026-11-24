import { LIMITS } from "@shared/config";
import { env } from "cloudflare:workers";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { handleRequest } from "../app";
import { createDeps } from "../deps";
import { ContentArchive } from "../retention/ContentArchive";
import { RetentionStore } from "../retention/RetentionStore";
import { Encryptor } from "../retention/Encryptor";
import {
  chatMessageCount,
  deps,
  enter,
  openLobby,
  openPairChat,
  ORIGIN,
  resetLobby,
  uniqueIp,
  uniqueName,
} from "../test/helpers";

beforeEach(resetLobby);
afterEach(() => {
  vi.restoreAllMocks();
});

const FAR_FUTURE = 8_640_000_000_000_000;
const SEVEN_MONTHS = 18_408_000_000;

interface AdminCallOptions {
  token?: string | null;
  ip?: string;
  appDeps?: typeof deps;
  method?: string;
}

function adminCall(path: string, body: unknown, opts: AdminCallOptions = {}): Promise<Response> {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    "CF-Connecting-IP": opts.ip ?? uniqueIp(),
  };
  const token = opts.token === undefined ? env.ADMIN_TOKEN : opts.token;
  if (token !== null) headers.Authorization = `Bearer ${token}`;
  return handleRequest(
    new Request(`${ORIGIN}/api/admin/${path}`, {
      method: opts.method ?? "POST",
      headers,
      body: JSON.stringify(body),
    }),
    env,
    opts.appDeps ?? deps,
  );
}

const WINDOW = { from: 0, to: FAR_FUTURE };
const RECENT = { from: Date.now() - 3_600_000, to: Date.now() + 3_600_000 };

it("admin routes 404 without the right token", async () => {
  const noHeader = await adminCall("lookup", RECENT, { token: null });
  expect(noHeader.status).toBe(404);
  const wrong = await adminCall("lookup", RECENT, { token: `${env.ADMIN_TOKEN}x` });
  expect(wrong.status).toBe(404);
  expect(await wrong.json()).toEqual({ error: "not_found" });
  const right = await adminCall("lookup", RECENT);
  expect(right.status).toBe(200);
  expect(right.headers.get("Cache-Control")).toBe("no-store");
  expect(wrong.headers.get("Cache-Control")).toBe("no-store");
});

it("admin routes 404 when no admin token is configured", async () => {
  const disabled = { ...deps, admin: createDeps({ ...env, ADMIN_TOKEN: "" }).admin };
  expect(disabled.admin).toBeNull();
  const res = await adminCall("lookup", RECENT, { appDeps: disabled });
  expect(res.status).toBe(404);
});

it("refuses an admin token shorter than 32 characters", () => {
  expect(() => createDeps({ ...env, ADMIN_TOKEN: "short" })).toThrow();
});

it("unknown admin paths and wrong methods 404 even with the token", async () => {
  expect((await adminCall("nope", {})).status).toBe(404);
  const get = await handleRequest(
    new Request(`${ORIGIN}/api/admin/lookup`, {
      headers: { Authorization: `Bearer ${env.ADMIN_TOKEN}`, "CF-Connecting-IP": uniqueIp() },
    }),
    env,
    deps,
  );
  expect(get.status).toBe(404);
});

it("rate limits admin calls to 10 a minute per network, answering 404", async () => {
  const ip = uniqueIp();
  for (let call = 0; call < LIMITS.adminRequestsPerNetwork.count; call++) {
    expect((await adminCall("lookup", RECENT, { ip, token: "wrong" })).status).toBe(404);
  }
  expect((await adminCall("lookup", RECENT, { ip })).status).toBe(404);
  expect((await adminCall("lookup", RECENT)).status).toBe(200);
});

it("rejects malformed admin bodies with 400", async () => {
  expect((await adminCall("lookup", { from: "x" })).status).toBe(400);
  expect((await adminCall("hold", { until: 5 })).status).toBe(400);
  expect((await adminCall("takedown", { chatId: "not-a-chat" })).status).toBe(400);
  expect((await adminCall("ban", {})).status).toBe(400);
});

it("lookup returns decrypted records for a nickname in a time window", async () => {
  const nickname = uniqueName("Mika");
  const ip = uniqueIp();
  const before = Date.now();
  const { me } = await enter({ nickname }, { ip });
  const res = await adminCall("lookup", {
    nickname: nickname.toLowerCase(),
    from: before - 1,
    to: Date.now() + 1,
  });
  const records = await res.json<{ connections: { userId: string; ip: string }[] }>();
  expect(records.connections).toHaveLength(1);
  expect(records.connections[0]).toMatchObject({ userId: me.userId, ip, nickname });
});

it("ban kicks an online user and blocks re-entry", async () => {
  const target = await enter();
  const wt = await openLobby(target.cookie);
  await wt.next("hello");
  const res = await adminCall("ban", { userId: target.me.userId });
  expect(res.status).toBe(200);
  expect(await res.json()).toMatchObject({ kicked: true });
  expect((await wt.next("kicked")).reason).toBe("banned");
  expect((await enter({}, { cookie: target.cookie })).res.status).toBe(403);
});

it("an owner ban starts at the longest device ban", async () => {
  const target = await enter();
  const before = Date.now();
  const res = await adminCall("ban", { userId: target.me.userId });
  const { deviceUntil, networkUntil } = await res.json<{
    deviceUntil: number;
    networkUntil: number;
  }>();
  const longest = LIMITS.deviceBanLadderMs.at(-1) ?? 0;
  expect(deviceUntil).toBeGreaterThanOrEqual(before + longest);
  expect(networkUntil).toBeLessThan(before + LIMITS.networkBanMs + 60_000);
});

it("lookups without a nickname or user id are limited to one day", async () => {
  const day = LIMITS.adminUnfilteredLookupMaxMs;
  expect((await adminCall("lookup", { from: 0, to: day + 1 })).status).toBe(400);
  expect((await adminCall("lookup", { from: 0, to: day })).status).toBe(200);
  expect((await adminCall("lookup", { nickname: "anyone", ...WINDOW })).status).toBe(200);
  expect((await adminCall("lookup", { userId: "anyone", ...WINDOW })).status).toBe(200);
});

it("ban of a departed user still bans their device", async () => {
  const target = await enter();
  const lobbyLeave = await openLobby(target.cookie);
  await lobbyLeave.next("hello");
  lobbyLeave.send({ type: "leave" });
  await lobbyLeave.closed;
  const res = await adminCall("ban", { userId: target.me.userId });
  expect(await res.json()).toMatchObject({ kicked: false });
  expect((await enter({}, { cookie: target.cookie })).res.status).toBe(403);
});

it("ban of an unknown user answers no_record", async () => {
  const res = await adminCall("ban", { userId: "nobody" });
  expect(res.status).toBe(404);
  expect(await res.json()).toEqual({ error: "no_record" });
});

it("takedown ends the chat and deletes its content rows", async () => {
  const { a, b, wa, wb, ca, cb, chatId } = await openPairChat();
  ca.send({ type: "send", clientId: "1", text: "hello" });
  await cb.next("message");
  await deps.retention.snapshotReport(chatId, "sexual", [
    { from: a.me.userId, text: "hello", sentAt: 1 },
  ]);
  const res = await adminCall("takedown", { chatId });
  expect(res.status).toBe(200);
  expect(await res.json()).toEqual({ evidenceSaved: 1, contentDeleted: 1, contentHeld: 1 });
  await ca.next("ended");
  expect((await wa.next("chatEnded")).chatId).toBe(chatId);
  expect((await wb.next("chatEnded")).chatId).toBe(chatId);
  expect(await chatMessageCount(chatId)).toBe(0);
  const records = await deps.retention.lookup({ userId: b.me.userId, ...WINDOW });
  const kept = records.content.filter((entry) => entry.chatId === chatId);
  expect(kept.map((entry) => entry.kind)).toEqual(["takedown_snapshot"]);
  expect(kept[0]?.messages.map((m) => m.text)).toEqual(["hello"]);
});

it("takedown saves the live messages of an unreported chat as held evidence", async () => {
  const { ca, cb, chatId } = await openPairChat();
  ca.send({ type: "send", clientId: "1", text: "evidence" });
  await cb.next("message");
  const res = await adminCall("takedown", { chatId });
  expect(await res.json()).toEqual({ evidenceSaved: 1, contentDeleted: 0, contentHeld: 1 });
  const row = await env.DB.prepare(
    "SELECT payload, hold_until FROM content_log WHERE chat_id = ? AND kind = 'takedown_snapshot'",
  )
    .bind(chatId)
    .first<{ payload: string; hold_until: number }>();
  expect(row?.payload).not.toContain("evidence");
  expect(row?.hold_until).toBeGreaterThan(Date.now() + LIMITS.reportedContentRetentionMs - 60_000);
});

it("takedown keeps content under a legal hold", async () => {
  const chatId = crypto.randomUUID().replaceAll("-", "").repeat(2);
  await deps.retention.snapshotReport(chatId, "spam", []);
  expect((await adminCall("hold", { chatId, until: FAR_FUTURE })).status).toBe(200);
  const res = await adminCall("takedown", { chatId });
  expect(await res.json()).toEqual({ evidenceSaved: 0, contentDeleted: 0, contentHeld: 1 });
});

it("admin 404s look exactly like any other API 404", async () => {
  const plain = await handleRequest(
    new Request(`${ORIGIN}/api/nothing`, {
      method: "POST",
      headers: { "CF-Connecting-IP": uniqueIp() },
    }),
    env,
    deps,
  );
  const admin = await adminCall("lookup", RECENT, { token: "wrong" });
  expect(admin.status).toBe(plain.status);
  expect([...admin.headers]).toEqual([...plain.headers]);
  expect(await admin.text()).toBe(await plain.text());
});

it("admin action names cannot reach object prototype keys", async () => {
  for (const name of ["__proto__", "constructor", "toString"]) {
    expect((await adminCall(name, {})).status).toBe(404);
  }
});

it("hold keeps rows past their retention period", async () => {
  const { me } = await enter();
  const res = await adminCall("hold", { userId: me.userId, until: FAR_FUTURE });
  expect(await res.json()).toEqual({ changed: 1 });
  const encryptor = new Encryptor(env.RETENTION_KEY);
  const later = new RetentionStore(
    env.DB,
    encryptor,
    deps.hasher,
    () => Date.now(),
    false,
    new ContentArchive(env.DB, env.ARCHIVE, encryptor, () => Date.now()),
  );
  await later.purgeExpired(Date.now() + SEVEN_MONTHS);
  const row = await env.DB.prepare("SELECT COUNT(*) AS n FROM connection_log WHERE user_id = ?")
    .bind(me.userId)
    .first<{ n: number }>();
  expect(row?.n).toBe(1);
});

it("admin actions never log plaintext identifiers", async () => {
  const info = vi.spyOn(console, "info").mockImplementation(() => undefined);
  const nickname = uniqueName("Log");
  const ip = uniqueIp();
  const { me } = await enter({ nickname }, { ip });
  await adminCall("lookup", { nickname, ...WINDOW });
  await adminCall("hold", { userId: me.userId, until: FAR_FUTURE });
  await adminCall("ban", { userId: me.userId });
  expect(info).toHaveBeenCalledWith("admin_action", expect.objectContaining({ action: "ban" }));
  const logged = JSON.stringify(info.mock.calls);
  expect(logged).not.toContain(nickname);
  expect(logged).not.toContain(ip);
  expect(logged).not.toContain(me.userId);
  expect(logged).not.toContain(env.ADMIN_TOKEN);
});
