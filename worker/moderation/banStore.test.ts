import { env } from "cloudflare:workers";
import { describe, expect, it } from "vitest";
import { BanStore } from "./banStore";

describe("BanStore", () => {
  it("device ladder escalates 1h, 24h, 7d; network ban is always 1h", async () => {
    const t = 1_000_000;
    const store = new BanStore(env.BANS, env.DB, () => t);
    const b1 = await store.issueBan("ladder-dev1", "ladder-netA");
    const b2 = await store.issueBan("ladder-dev1", "ladder-netB");
    const b3 = await store.issueBan("ladder-dev1", "ladder-netC");
    const b4 = await store.issueBan("ladder-dev1", "ladder-netD");
    expect([b1.deviceUntil, b2.deviceUntil, b3.deviceUntil, b4.deviceUntil]).toEqual([
      t + 3_600_000,
      t + 86_400_000,
      t + 604_800_000,
      t + 604_800_000,
    ]);
    expect([b1.networkUntil, b3.networkUntil]).toEqual([t + 3_600_000, t + 3_600_000]);
    expect((await store.issueBan("ladder-dev9", "ladder-netA")).deviceUntil).toBe(t + 3_600_000);
  });

  it("forgets bans older than the history window", async () => {
    let t = 0;
    const store = new BanStore(env.BANS, env.DB, () => t);
    await store.issueBan("history-dev", "history-net");
    t = 2_592_000_001;
    expect((await store.issueBan("history-dev", "history-net")).deviceUntil).toBe(t + 3_600_000);
  });

  it("finds bans by device or network and expires them", async () => {
    let t = 0;
    const store = new BanStore(env.BANS, env.DB, () => t);
    await store.issueBan("find-dev2", "find-netZ");
    expect(await store.getActiveBan("find-dev2", "other")).not.toBeNull();
    expect(await store.getActiveBan(null, "find-netZ")).toEqual({ until: 3_600_000 });
    expect(await store.getActiveBan("nobody", "nowhere")).toBeNull();
    t = 3_600_001;
    expect(await store.getActiveBan(null, "find-netZ")).toBeNull();
  });

  it("reports the later end when device and network are both banned", async () => {
    const t = 5_000;
    const store = new BanStore(env.BANS, env.DB, () => t);
    await store.issueBan("both-dev", "both-net0");
    await store.issueBan("both-dev", "both-net1");
    expect(await store.getActiveBan("both-dev", "both-net1")).toEqual({ until: t + 86_400_000 });
  });

  it("stores ban history in D1", async () => {
    const store = new BanStore(env.BANS, env.DB, () => 7);
    await store.issueBan("row-dev", "row-net");
    const row = await env.DB.prepare("SELECT * FROM bans WHERE device_hash = ?")
      .bind("row-dev")
      .first();
    expect(row).toMatchObject({
      network_hash: "row-net",
      level: 0,
      starts_at: 7,
      device_expires_at: 7 + 3_600_000,
      network_expires_at: 7 + 3_600_000,
    });
  });

  it("reports when a device was last banned", async () => {
    let t = 50;
    const store = new BanStore(env.BANS, env.DB, () => t);
    expect(await store.lastBanAt("last-dev")).toBeNull();
    await store.issueBan("last-dev", "last-net");
    t = 90;
    await store.issueBan("last-dev", "last-net");
    expect(await store.lastBanAt("last-dev")).toBe(90);
  });
});
