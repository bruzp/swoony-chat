import { LIMITS } from "@shared/config";
import type { ActiveHold } from "@shared/protocol/admin";
import { beforeEach, expect, it } from "vitest";
import { adminDeps, adminEnv, adminToken, webAdminCall } from "../test/adminAccess";
import { enter, resetLobby, uniqueIp, uniqueName } from "../test/helpers";

beforeEach(resetLobby);

const FAR_FUTURE = 8_640_000_000_000_000;
const WINDOW = { from: 0, to: FAR_FUTURE };
const CASE = "NBI-2026-1142";

it("hides every route from a request without a valid sign-in", async () => {
  const missing = await webAdminCall(
    "lookup",
    { caseRef: CASE, userId: "x", ...WINDOW },
    {
      token: null,
    },
  );
  expect(missing.status).toBe(404);
  expect(await missing.json()).toEqual({ error: "not_found" });
  const stranger = await webAdminCall("holds", {}, { token: await adminToken("x@example.com") });
  expect(stranger.status).toBe(404);
  const off = await webAdminCall("holds", {}, { appDeps: { ...adminDeps, access: null } });
  expect(off.status).toBe(404);
});

it("refuses calls from another origin or without one", async () => {
  const other = await webAdminCall("holds", {}, { origin: "https://evil.example" });
  expect(other.status).toBe(403);
  expect(await other.json()).toEqual({ error: "bad_origin" });
  expect((await webAdminCall("holds", {}, { origin: null })).status).toBe(403);
});

it("accepts only JSON POST requests", async () => {
  const get = await webAdminCall("holds", {}, { method: "GET" });
  expect(get.status).toBe(405);
  const form = await webAdminCall("holds", {}, { contentType: "text/plain" });
  expect(form.status).toBe(415);
  const broken = await webAdminCall("lookup", {}, { rawBody: "{not json" });
  expect(broken.status).toBe(400);
});

it.each([undefined, "ab", "a".repeat(41), "NBI 2026", "NBI_2026", "<script>"])(
  "refuses a search with case reference %s",
  async (caseRef) => {
    const res = await webAdminCall("lookup", { caseRef, userId: "anyone", ...WINDOW });
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "invalid_case_ref" });
  },
);

it("looks up records with a case reference", async () => {
  const nickname = uniqueName("Web");
  const ip = uniqueIp();
  const { me } = await enter({ nickname }, { ip });
  const res = await webAdminCall("lookup", { caseRef: "NBI-2026/1142", nickname, ...WINDOW });
  expect(res.status).toBe(200);
  const records = await res.json<{ connections: { userId: string; ip: string }[] }>();
  expect(records.connections).toMatchObject([{ userId: me.userId, ip, nickname }]);
});

it("answers bad input and missing records in readable JSON", async () => {
  const bad = await webAdminCall("lookup", { caseRef: CASE, from: "x" });
  expect(bad.status).toBe(400);
  expect(await bad.json()).toEqual({ error: "invalid_request" });
  const none = await webAdminCall("ban", { caseRef: CASE, userId: "nobody" });
  expect(none.status).toBe(404);
  expect(await none.json()).toEqual({ error: "no_record" });
});

it("bans, takes down and holds through the same actions as the CLI", async () => {
  const target = await enter();
  const ban = await webAdminCall("ban", { caseRef: CASE, userId: target.me.userId });
  expect(ban.status).toBe(200);
  expect((await enter({}, { cookie: target.cookie })).res.status).toBe(403);
  const hold = await webAdminCall("hold", {
    caseRef: CASE,
    userId: target.me.userId,
    until: FAR_FUTURE,
  });
  expect(await hold.json()).toEqual({ changed: 1 });
});

it("lists active holds and offers no way to release them", async () => {
  const { me } = await enter();
  await webAdminCall("hold", { caseRef: CASE, userId: me.userId, until: FAR_FUTURE });
  const res = await webAdminCall("holds");
  expect(res.status).toBe(200);
  const { holds } = await res.json<{ holds: ActiveHold[] }>();
  expect(holds).toContainEqual({
    table: "connections",
    targetKind: "user",
    target: me.userId,
    until: FAR_FUTURE,
    records: 1,
  });
  expect((await webAdminCall("release", { caseRef: CASE, userId: me.userId })).status).toBe(404);
});

it("does not list holds that have ended", async () => {
  const { me } = await enter();
  const past = Date.now() - 1_000;
  await webAdminCall("hold", { caseRef: CASE, userId: me.userId, until: past });
  const { holds } = await (await webAdminCall("holds")).json<{ holds: ActiveHold[] }>();
  expect(holds.map((hold) => hold.target)).not.toContain(me.userId);
});

it("unknown routes and prototype keys answer not_found", async () => {
  for (const name of ["nope", "__proto__", "constructor"]) {
    expect((await webAdminCall(name, { caseRef: CASE })).status).toBe(404);
  }
});

it("rate limits web admin calls per network with a readable answer", async () => {
  const ip = uniqueIp();
  for (let call = 0; call < LIMITS.webAdminRequestsPerNetwork.count; call++) {
    expect((await webAdminCall("holds", {}, { ip })).status).toBe(200);
  }
  const limited = await webAdminCall("holds", {}, { ip });
  expect(limited.status).toBe(429);
  expect(await limited.json()).toEqual({ error: "rate_limited" });
});

it("stays reachable for the owner from a blocked country", async () => {
  expect((await webAdminCall("holds", {}, { country: "GB" })).status).toBe(200);
});

it("tells the page who is signed in", async () => {
  const res = await webAdminCall("whoami");
  expect(res.status).toBe(200);
  expect(await res.json()).toEqual({ email: "owner@example.com" });
});

it("keeps working when the rate limiter cannot be reached", async () => {
  const brokenLobby = {
    idFromName: () => ({}),
    get: () => ({ hitWebAdminLimit: () => Promise.reject(new Error("lobby down")) }),
  } as unknown as Env["LOBBY"];
  const res = await webAdminCall("holds", {}, { appEnv: { ...adminEnv, LOBBY: brokenLobby } });
  expect(res.status).toBe(200);
});
