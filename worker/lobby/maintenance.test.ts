import type { MaintenanceState } from "@shared/protocol/admin";
import { KICKED_CLOSE_CODE } from "@shared/protocol/lobby";
import { env } from "cloudflare:workers";
import { beforeEach, expect, it } from "vitest";
import { handleRequest } from "../app";
import { webAdminCall } from "../test/adminAccess";
import {
  deps,
  enter,
  getSession,
  openPairChat,
  ORIGIN,
  resetLobby,
  uniqueIp,
} from "../test/helpers";

beforeEach(async () => {
  await resetLobby();
  await env.DB.prepare("DELETE FROM admin_audit").run();
});

function setMaintenance(on: boolean, message = ""): Promise<Response> {
  return webAdminCall("maintenance", { set: { on, message } });
}

async function publicHealth(): Promise<unknown> {
  const res = await handleRequest(
    new Request(`${ORIGIN}/api/health`, { headers: { "CF-Connecting-IP": uniqueIp() } }),
    env,
    deps,
  );
  return res.json();
}

it("starts off", async () => {
  const res = await webAdminCall("maintenance", {});
  expect(await res.json()).toEqual({ on: false, message: "", startedAt: null, startedBy: null });
});

it("turning it on removes everyone right away and ends every chat", async () => {
  const { wa, wb, ca, cb } = await openPairChat();
  const res = await setMaintenance(true, "Back at 3 pm");
  expect(res.status).toBe(200);
  const state = await res.json<MaintenanceState>();
  expect(state).toMatchObject({
    on: true,
    message: "Back at 3 pm",
    startedBy: "owner@example.com",
  });
  expect((await wa.next("kicked")).reason).toBe("maintenance");
  expect((await wb.next("kicked")).reason).toBe("maintenance");
  expect((await wa.closed).code).toBe(KICKED_CLOSE_CODE);
  await ca.next("ended");
  await cb.next("ended");
});

it("refuses entry and sessions with the maintenance answer while on", async () => {
  const before = await enter();
  await setMaintenance(true, "Short update");
  const entry = await enter();
  expect(entry.res.status).toBe(503);
  expect(await entry.res.json()).toEqual({ error: "maintenance", message: "Short update" });
  const session = await getSession(before.cookie);
  expect(session.status).toBe(503);
  expect(await session.json()).toEqual({ error: "maintenance", message: "Short update" });
});

it("the public health check reports maintenance and admin routes keep working", async () => {
  await setMaintenance(true);
  expect(await publicHealth()).toEqual({ status: "maintenance" });
  expect((await webAdminCall("holds")).status).toBe(200);
});

it("turning it off reopens entry without restoring anyone", async () => {
  const before = await enter();
  await setMaintenance(true);
  const off = await setMaintenance(false);
  expect(await off.json()).toMatchObject({ on: false });
  const session = await getSession(before.cookie);
  expect(await session.json()).toMatchObject({ me: null });
  expect((await enter()).res.status).toBe(201);
  expect(await publicHealth()).toEqual({ status: "ok" });
});

it("writes an activity row for each change", async () => {
  await setMaintenance(true);
  await setMaintenance(false);
  const { results } = await env.DB.prepare(
    "SELECT action, actor FROM admin_audit ORDER BY id",
  ).all();
  expect(results).toEqual([
    { action: "maintenance_on", actor: "owner@example.com" },
    { action: "maintenance_off", actor: "owner@example.com" },
  ]);
});

it("refuses a message that is too long", async () => {
  const res = await setMaintenance(true, "x".repeat(201));
  expect(res.status).toBe(400);
});
