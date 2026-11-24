import { env } from "cloudflare:workers";
import { describe, expect, it, vi } from "vitest";
import { createDeps, depsFor } from "./deps";

const cookieRequest = (setCookie: string) =>
  new Request("http://x", { headers: { Cookie: setCookie.split(";")[0] ?? "" } });

describe("depsFor", () => {
  it("builds dependencies once per env and reuses them", () => {
    expect(depsFor(env)).toBe(depsFor(env));
    expect(depsFor({ ...env })).not.toBe(depsFor(env));
  });
});

describe("createDeps", () => {
  it("builds every dependency from a valid env", () => {
    const deps = createDeps(env);
    expect(Object.keys(deps).sort()).toEqual(
      [
        "access",
        "admin",
        "alerts",
        "audit",
        "bans",
        "botCheck",
        "cookies",
        "hasher",
        "jobs",
        "now",
        "reports",
        "retention",
      ].sort(),
    );
    expect(typeof deps.now()).toBe("number");
  });

  it("allows the localhost admin sign-in only with both dev-server flags", async () => {
    const local = new Request("http://localhost:5173/s-admin");
    const stray = createDeps({
      ...env,
      ADMIN_DEV_EMAIL: "dev@localhost",
      DEV_INSECURE_COOKIES: "0",
    });
    expect(await stray.access?.verify(local)).toBeNull();
    const dev = createDeps({ ...env, ADMIN_DEV_EMAIL: "dev@localhost", DEV_INSECURE_COOKIES: "1" });
    expect(await dev.access?.verify(local)).toBe("dev@localhost");
  });

  it("turns the web admin off when no Access settings are given", () => {
    const off = createDeps({ ...env, ACCESS_TEAM_DOMAIN: "", ACCESS_AUD: "", ADMIN_EMAILS: "" });
    expect(off.access).toBeNull();
    expect(createDeps(env).access).not.toBeNull();
  });

  it("turns only the web admin off when its settings are incomplete or wrong", () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => undefined);
    expect(createDeps({ ...env, ACCESS_AUD: "" }).access).toBeNull();
    expect(
      createDeps({ ...env, ACCESS_TEAM_DOMAIN: "swoony.cloudflareaccess.com" }).access,
    ).toBeNull();
    expect(error).toHaveBeenCalledWith("admin_access_misconfigured");
    error.mockRestore();
  });

  it("turns only alert emails off when their settings are incomplete", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const deps = createDeps({ ...env, ALERT_EMAIL_TO: "owner@example.com" });
    expect(error).toHaveBeenCalledWith("alert_email_misconfigured");
    expect(await deps.alerts.notify("cleanup_failed", "s", "t")).toBe(false);
    error.mockRestore();
    warn.mockRestore();
  });

  it("refuses missing or short secrets", () => {
    expect(() => createDeps({ ...env, COOKIE_SECRETS: "" })).toThrow();
    expect(() => createDeps({ ...env, COOKIE_SECRETS: "short" })).toThrow();
    expect(() => createDeps({ ...env, COOKIE_SECRETS: `${"a".repeat(32)},short` })).toThrow();
    expect(() => createDeps({ ...env, IDENTITY_HASH_SECRET: "" })).toThrow();
    expect(() => createDeps({ ...env, TURNSTILE_SECRET: "" })).toThrow();
    expect(() => createDeps({ ...env, RETENTION_KEY: "" })).toThrow();
  });

  it("accepts rotated cookie secrets with spaces", async () => {
    const newer = "n".repeat(32);
    const older = "o".repeat(32);
    const { deviceId, setCookie } = await createDeps({
      ...env,
      COOKIE_SECRETS: older,
    }).cookies.issue();
    const rotated = createDeps({ ...env, COOKIE_SECRETS: ` ${newer} , ${older} ` });
    expect(await rotated.cookies.read(cookieRequest(setCookie))).toBe(deviceId);
  });

  it("issues insecure cookies only when DEV_INSECURE_COOKIES is 1", async () => {
    const secure = createDeps({ ...env, DEV_INSECURE_COOKIES: "0" });
    const insecure = createDeps({ ...env, DEV_INSECURE_COOKIES: "1" });
    expect((await secure.cookies.issue()).setCookie).toMatch(/; Secure$/);
    expect((await insecure.cookies.issue()).setCookie).not.toMatch(/Secure/);
  });

  it("enables full content retention only for the exact string true", async () => {
    const message = { from: "u", text: "hi", sentAt: 1 };
    await createDeps({ ...env, RETAIN_ALL_CONTENT: "TRUE" }).retention.archiveMessages("rac-up", [
      message,
    ]);
    await createDeps({ ...env, RETAIN_ALL_CONTENT: "true" }).retention.archiveMessages("rac-on", [
      message,
    ]);
    const rows = await env.DB.prepare(
      "SELECT chat_id FROM content_archive WHERE chat_id IN ('rac-up', 'rac-on')",
    ).all<{ chat_id: string }>();
    expect(rows.results.map((r) => r.chat_id)).toEqual(["rac-on"]);
  });

  it("shares one injected clock with every store", async () => {
    const deps = createDeps(env, () => 0);
    expect(deps.now()).toBe(0);
    await deps.bans.issueBan("clock-dev", "clock-net");
    expect(await deps.bans.getActiveBan("clock-dev", "clock-net")).toEqual({ until: 3_600_000 });
    await deps.retention.snapshotReport("clock-chat", "spam", []);
    const row = await env.DB.prepare("SELECT created_at FROM content_log WHERE chat_id = ?")
      .bind("clock-chat")
      .first<{ created_at: number }>();
    expect(row?.created_at).toBe(0);
  });
});
