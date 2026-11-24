import { LIMITS } from "@shared/config";
import { REPLACED_CLOSE_CODE } from "@shared/protocol/lobby";
import type { ApiError, SessionBootstrap } from "@shared/protocol/api";
import { runInDurableObject } from "cloudflare:test";
import { env } from "cloudflare:workers";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { handleRequest } from "../app";
import { networkKey } from "../http/requestInfo";
import { Lobby } from "./Lobby";
import { lobbyStub } from "./lobbyStub";
import {
  ORIGIN,
  deps,
  deviceIdFrom,
  enter,
  getSession,
  openLobby,
  rawUpgrade,
  resetLobby,
  uniqueIp,
  uniqueName,
} from "../test/helpers";

beforeEach(resetLobby);
afterEach(() => {
  vi.restoreAllMocks();
});

async function freshCookie(): Promise<string> {
  const res = await getSession(null);
  return (res.headers.get("Set-Cookie") ?? "").split(";")[0] ?? "";
}

it("enters with a valid profile and returns a public user without device id", async () => {
  const { res, me } = await enter();
  expect(res.status).toBe(201);
  expect(Object.keys(me).sort()).toEqual(["age", "bio", "country", "gender", "nickname", "userId"]);
});

it("issues a signed HttpOnly device cookie on entry", async () => {
  const { res } = await enter();
  const setCookie = res.headers.get("Set-Cookie") ?? "";
  expect(setCookie).toMatch(/^sw_dev=/);
  expect(setCookie).toContain("HttpOnly");
});

it("requires 18+ confirmation", async () => {
  const { res } = await enter({}, { confirmedAdult: false });
  expect(res.status).toBe(400);
  expect(await res.json()).toEqual({ error: "invalid_profile", field: "confirmedAdult" });
});

it("reports the first invalid profile field", async () => {
  const { res } = await enter({ age: 17 });
  expect(res.status).toBe(400);
  expect(await res.json()).toEqual({ error: "invalid_profile", field: "age" });
});

it("rejects a body that is not json", async () => {
  const res = await handleRequest(
    new Request(`${ORIGIN}/api/session`, {
      method: "POST",
      headers: { Origin: ORIGIN, "CF-Connecting-IP": uniqueIp() },
      body: "{nope",
    }),
    env,
    deps,
  );
  expect(res.status).toBe(400);
  expect(await res.json()).toEqual({ error: "invalid_profile", field: "body" });
});

it("rejects failed bot check", async () => {
  const { res } = await enter({}, { turnstileToken: "fail" });
  expect(res.status).toBe(403);
  expect(await res.json()).toEqual({ error: "bot_check_failed" });
});

it("returns 451 for blocked countries", async () => {
  const blocked = await getSession(null, { country: "GB" });
  expect(blocked.status).toBe(451);
  expect(await blocked.json()).toEqual({ error: "region_unavailable" });
  expect((await enter({}, { country: "AU" })).res.status).toBe(451);
  expect((await getSession(null, { country: "PH" })).status).toBe(200);
});

it("keeps /api/health open in blocked countries", async () => {
  const res = await handleRequest(
    new Request(`${ORIGIN}/api/health`, { cf: { country: "GB" } }),
    env,
    deps,
  );
  expect(res.status).toBe(200);
});

it("rejects entry from foreign origin", async () => {
  const { res } = await enter({}, { origin: "https://evil.example" });
  expect(res.status).toBe(403);
  expect(await res.json()).toEqual({ error: "bad_origin" });
});

it("rejects profane nickname", async () => {
  expect(await (await enter({ nickname: "dick_guy" })).res.json()).toEqual({
    error: "bad_nickname",
  });
});

it("rejects a bio with a link", async () => {
  const { res } = await enter({ bio: "see example.com" });
  expect(res.status).toBe(400);
  expect(await res.json()).toEqual({ error: "bad_bio", reason: "link" });
});

it("stores the cleaned bio", async () => {
  const { me } = await enter({ bio: "  hello there  " });
  expect(me.bio).toBe("hello there");
});

it("nickname uniqueness is case-insensitive", async () => {
  const n = uniqueName();
  await enter({ nickname: n });
  const again = await enter({ nickname: n.toUpperCase() });
  expect(again.res.status).toBe(409);
  expect(await again.res.json()).toEqual({ error: "nickname_taken" });
});

it("second tab resumes the same user", async () => {
  const first = await enter();
  const again = await enter({}, { cookie: first.cookie });
  expect(again.res.status).toBe(200);
  expect(again.me.userId).toBe(first.me.userId);
});

it("GET /api/session returns me for a live session", async () => {
  const { cookie, me } = await enter();
  const res = await getSession(cookie);
  expect(res.status).toBe(200);
  const bootstrap = await res.json<SessionBootstrap>();
  expect(bootstrap.me?.userId).toBe(me.userId);
  expect(bootstrap.ban).toBeNull();
  expect(res.headers.get("Set-Cookie")).toMatch(/^sw_dev=/);
});

it("GET /api/session without a session suggests the request country", async () => {
  const res = await getSession(null, { country: "JP" });
  const bootstrap = await res.json<SessionBootstrap>();
  expect(bootstrap).toEqual({ me: null, suggestedCountry: "JP", ban: null });
});

it("GET /api/session suggests no country for non-country cf codes", async () => {
  const res = await getSession(null, { country: "T1" });
  expect((await res.json<SessionBootstrap>()).suggestedCountry).toBeNull();
});

it("rate-limits the 6th entry from one device within 10 minutes", async () => {
  const cookie = await freshCookie();
  const statuses: number[] = [];
  for (let attempt = 0; attempt < 6; attempt++) {
    statuses.push((await enter({}, { cookie, turnstileToken: "fail" })).res.status);
  }
  expect(statuses).toEqual([403, 403, 403, 403, 403, 429]);
  expect(await (await enter({}, { cookie })).res.json()).toEqual({ error: "rate_limited" });
});

it("allows 30 entries per network then limits", async () => {
  const ip = uniqueIp();
  for (let entry = 0; entry < 30; entry++) {
    expect((await enter({}, { ip })).res.status).toBe(201);
  }
  expect((await enter({}, { ip })).res.status).toBe(429);
});

it("banned device cannot enter and gets until", async () => {
  const { cookie } = await enter();
  await deps.bans.issueBan(
    await deps.hasher.hash(await deviceIdFrom(cookie)),
    await deps.hasher.hash(uniqueIp()),
  );
  const again = await enter({}, { cookie });
  expect(again.res.status).toBe(403);
  const body = await again.res.json<ApiError & { until: number }>();
  expect(body.error).toBe("banned");
  expect(body.until).toBeGreaterThan(Date.now());
  expect((await getSession(cookie).then((res) => res.json<SessionBootstrap>())).ban).toEqual({
    until: body.until,
  });
});

it("banned network cannot enter", async () => {
  const ip = uniqueIp();
  await deps.bans.issueBan(
    await deps.hasher.hash("other-device"),
    await deps.hasher.hash(networkKey(ip)),
  );
  const { res } = await enter({}, { ip });
  expect(res.status).toBe(403);
  expect((await res.json<ApiError>()).error).toBe("banned");
});

it("lets the user in and logs when the ban lookup fails", async () => {
  const error = vi.spyOn(console, "error").mockImplementation(() => undefined);
  vi.spyOn(deps.bans, "getActiveBan").mockRejectedValue(new Error("kv down"));
  const { res } = await enter();
  expect(res.status).toBe(201);
  expect(error).toHaveBeenCalledWith("ban_lookup_failed");
});

it("lets the user in when the stored ban is corrupt", async () => {
  vi.spyOn(console, "error").mockImplementation(() => undefined);
  const cookie = await freshCookie();
  const deviceHash = await deps.hasher.hash(await deviceIdFrom(cookie));
  await env.BANS.put(`ban:device:${deviceHash}`, "{not json");
  expect((await enter({}, { cookie })).res.status).toBe(201);
});

it("rejects lobby upgrade from foreign origin", async () => {
  const { cookie } = await enter();
  expect((await rawUpgrade("/api/lobby", cookie, "https://evil.example")).status).toBe(403);
});

it("rejects lobby upgrade without a cookie or session", async () => {
  expect((await rawUpgrade("/api/lobby", null)).status).toBe(401);
  expect((await rawUpgrade("/api/lobby", await freshCookie())).status).toBe(401);
});

it("rejects lobby upgrade for a banned device", async () => {
  const { cookie } = await enter();
  await deps.bans.issueBan(
    await deps.hasher.hash(await deviceIdFrom(cookie)),
    await deps.hasher.hash(uniqueIp()),
  );
  const res = await rawUpgrade("/api/lobby", cookie);
  expect(res.status).toBe(403);
  expect((await res.json<ApiError>()).error).toBe("banned");
});

it("rejects a lobby request that is not an upgrade", async () => {
  const { cookie } = await enter();
  const res = await handleRequest(
    new Request(`${ORIGIN}/api/lobby`, { headers: { Origin: ORIGIN, Cookie: cookie } }),
    env,
    deps,
  );
  expect(res.status).toBe(426);
});

it("ignores a client-supplied device header on the lobby upgrade", async () => {
  const victim = await enter();
  const attacker = await enter();
  const res = await rawUpgrade("/api/lobby", attacker.cookie, ORIGIN, {
    "X-Swoony-Device": await deviceIdFrom(victim.cookie),
  });
  if (!res.webSocket) throw new Error("expected a socket");
  const ws = res.webSocket;
  const hello = new Promise<string>((resolve) => {
    ws.addEventListener("message", (event) => {
      resolve(String(event.data));
    });
  });
  ws.accept();
  expect(JSON.parse(await hello)).toMatchObject({ me: { userId: attacker.me.userId } });
  ws.close();
});

it("lobby socket greets with hello", async () => {
  const { cookie, me } = await enter();
  const ws = await openLobby(cookie);
  const hello = await ws.next("hello");
  expect(hello.me.userId).toBe(me.userId);
  expect(hello.chats).toEqual([]);
  expect(hello.online).toBeGreaterThanOrEqual(0);
  await ws.close();
});

it("entering writes an encrypted connection record with picked and detected country", async () => {
  const ip = uniqueIp();
  const { me } = await enter({ country: "JP" }, { ip, country: "PH" });
  const records = await deps.retention.lookup({
    nickname: me.nickname,
    from: 0,
    to: Date.now() + 1000,
  });
  expect(records.connections).toEqual([
    expect.objectContaining({
      userId: me.userId,
      ip,
      country: "JP",
      detectedCountry: "PH",
      nickname: me.nickname,
    }),
  ]);
  const row = await env.DB.prepare("SELECT payload FROM connection_log WHERE user_id = ?")
    .bind(me.userId)
    .first<{ payload: string }>();
  expect(row?.payload).not.toContain(ip);
  expect(row?.payload).not.toContain(me.nickname);
});

it("drops oversized frames and rate-limits chatty sockets", async () => {
  const { cookie } = await enter();
  const ws = await openLobby(cookie);
  await ws.next("hello");
  const oversized = JSON.stringify({ type: "noop", pad: "x".repeat(5 * 1024) });
  for (let frame = 0; frame < 25; frame++) ws.sendRaw(oversized);
  for (let frame = 0; frame < 20; frame++) ws.send({ type: "noop" });
  await ws.expectNone("notice");
  ws.send({ type: "noop" });
  expect(await ws.next("notice")).toEqual({ type: "notice", code: "slow_down" });
  await ws.close();
});

it("answers ping with pong", async () => {
  const { cookie } = await enter();
  const res = await rawUpgrade("/api/lobby", cookie);
  if (!res.webSocket) throw new Error("expected a socket");
  const ws = res.webSocket;
  const pong = new Promise<string>((resolve) => {
    ws.addEventListener("message", (event) => {
      if (event.data === "pong") resolve("pong");
    });
  });
  ws.accept();
  ws.send("ping");
  expect(await pong).toBe("pong");
  ws.close();
});

function rateEventKeys(): Promise<{ bucket: string; key: string }[]> {
  return runInDurableObject(lobbyStub(env), (_instance, state) =>
    state.storage.sql
      .exec<{ bucket: string; key: string }>("SELECT bucket, key FROM rate_events")
      .toArray(),
  );
}

it("stores entry rate-limit keys hashed, never raw ip or device id", async () => {
  const ip = uniqueIp();
  const { cookie } = await enter({}, { ip });
  const deviceId = await deviceIdFrom(cookie);
  const keys = (await rateEventKeys()).map((row) => row.key);
  expect(keys).toHaveLength(2);
  expect(keys).not.toContain(ip);
  expect(keys).not.toContain(deviceId);
});

it("checks maintenance and the session with one Lobby call", async () => {
  const user = await enter();
  const maintenance = vi.spyOn(Lobby.prototype, "getMaintenance");
  const session = vi.spyOn(Lobby.prototype, "getSession");
  try {
    const bootstrap = await (await getSession(user.cookie)).json<SessionBootstrap>();
    expect(bootstrap.me).not.toBeNull();
    await enter({}, { cookie: user.cookie });
    const ws = await openLobby(user.cookie);
    await ws.next("hello");
    expect(maintenance).not.toHaveBeenCalled();
    expect(session).not.toHaveBeenCalled();
  } finally {
    maintenance.mockRestore();
    session.mockRestore();
  }
});

it("caps lobby sockets per user by closing the oldest", async () => {
  const { cookie } = await enter();
  const sockets = [];
  for (let socket = 0; socket <= LIMITS.socketsPerUser; socket++) {
    const ws = await openLobby(cookie);
    await ws.next("hello");
    sockets.push(ws);
  }
  const [oldest, ...rest] = sockets;
  expect((await oldest?.closed)?.code).toBe(REPLACED_CLOSE_CODE);
  for (const ws of rest) await ws.ping();
  await Promise.all(rest.map((ws) => ws.close()));
});

it("failed bot checks do not use up the network entry budget", async () => {
  const ip = uniqueIp();
  for (let attempt = 0; attempt < LIMITS.entriesPerNetwork.count; attempt++) {
    expect((await enter({}, { ip, turnstileToken: "fail" })).res.status).toBe(403);
  }
  expect((await enter({}, { ip })).res.status).toBe(201);
});

it("accepts an entry body of exactly the size limit", async () => {
  const base = JSON.stringify({
    nickname: uniqueName(),
    gender: "female",
    age: 24,
    country: "PH",
    confirmedAdult: true,
    turnstileToken: "ok",
    pad: "",
  });
  const body = base.replace(
    '"pad":""',
    `"pad":"${"x".repeat(LIMITS.maxEntryBodyBytes - base.length)}"`,
  );
  expect(new TextEncoder().encode(body).byteLength).toBe(LIMITS.maxEntryBodyBytes);
  const res = await handleRequest(
    new Request(`${ORIGIN}/api/session`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Origin: ORIGIN,
        "CF-Connecting-IP": uniqueIp(),
      },
      body,
      cf: { country: "PH" },
    }),
    env,
    deps,
  );
  expect(res.status).toBe(201);
});

it("refuses an oversized entry body", async () => {
  const padding = "x".repeat(LIMITS.maxEntryBodyBytes);
  const { res } = await enter({ bio: "", padding } as Parameters<typeof enter>[0]);
  expect(res.status).toBe(400);
  expect(await res.json()).toEqual({ error: "invalid_profile", field: "body" });
});

it("refuses an oversized streamed entry body with no length header", async () => {
  const encoder = new TextEncoder();
  const chunks = [
    encoder.encode('{"pad":"'),
    ...Array.from({ length: 6 }, () => encoder.encode("x".repeat(1024))),
    encoder.encode('"}'),
  ];
  const body = new ReadableStream<Uint8Array>({
    pull(controller) {
      const next = chunks.shift();
      if (next) controller.enqueue(next);
      else controller.close();
    },
  });
  const res = await handleRequest(
    new Request(`${ORIGIN}/api/session`, {
      method: "POST",
      headers: { Origin: ORIGIN, "CF-Connecting-IP": uniqueIp() },
      body,
      cf: { country: "PH" },
    }),
    env,
    deps,
  );
  expect(res.status).toBe(400);
  expect(await res.json()).toEqual({ error: "invalid_profile", field: "body" });
});
