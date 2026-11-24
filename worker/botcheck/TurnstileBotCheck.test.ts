import { afterEach, describe, expect, it, vi } from "vitest";
import { TurnstileBotCheck } from "./TurnstileBotCheck";

const SITEVERIFY = "https://challenges.cloudflare.com/turnstile/v0/siteverify";

function check(body: object, overrides: { hostnames?: string[]; action?: string | null } = {}) {
  return new TurnstileBotCheck({
    secret: "s",
    expectedHostnames: overrides.hostnames ?? ["swoony.chat"],
    expectedAction: overrides.action === undefined ? "enter" : overrides.action,
    fetcher: () => Promise.resolve(Response.json(body)),
  });
}

function unchecked(fetcher: typeof fetch) {
  return new TurnstileBotCheck({
    secret: "s",
    expectedHostnames: [],
    expectedAction: null,
    fetcher,
  });
}

describe("TurnstileBotCheck", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("checks success, hostname and action", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const ok = { success: true, hostname: "swoony.chat", action: "enter" };
    expect(await check(ok).verify("t", "1.1.1.1")).toBe(true);
    expect(await check({ ...ok, hostname: "evil.example" }).verify("t", "1.1.1.1")).toBe(false);
    expect(await check({ ...ok, action: "other" }).verify("t", "1.1.1.1")).toBe(false);
    expect(await check({ success: false }).verify("t", "1.1.1.1")).toBe(false);
  });

  it("skips hostname and action checks when not configured", async () => {
    const local = check(
      { success: true, hostname: "example.com" },
      { hostnames: [], action: null },
    );
    expect(await local.verify("t", "1.1.1.1")).toBe(true);
  });

  it("posts secret, token and ip to siteverify", async () => {
    const calls: { url: string; method: string; form: FormData }[] = [];
    const bot = new TurnstileBotCheck({
      secret: "my-secret",
      expectedHostnames: [],
      expectedAction: null,
      fetcher: async (input, init) => {
        const sent = new Request(input, init);
        calls.push({ url: sent.url, method: sent.method, form: await sent.formData() });
        return Response.json({ success: true });
      },
    });
    await bot.verify("tok", "9.9.9.9");
    expect(calls).toHaveLength(1);
    expect(calls[0]?.url).toBe(SITEVERIFY);
    expect(calls[0]?.method).toBe("POST");
    const params = calls[0]?.form ?? new FormData();
    expect(params.get("secret")).toBe("my-secret");
    expect(params.get("response")).toBe("tok");
    expect(params.get("remoteip")).toBe("9.9.9.9");
  });

  it("rejects empty and oversized tokens without calling siteverify", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const fetcher = vi.fn(() => Promise.resolve(Response.json({ success: true })));
    const bot = unchecked(fetcher);
    expect(await bot.verify("", "1.1.1.1")).toBe(false);
    expect(await bot.verify("t".repeat(2049), "1.1.1.1")).toBe(false);
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("fails closed on network error, bad status or bad json", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const down = unchecked(() => Promise.reject(new Error("down")));
    const serverError = unchecked(() => Promise.resolve(new Response("oops", { status: 500 })));
    const notJson = unchecked(() => Promise.resolve(new Response("not json")));
    expect(await down.verify("t", "1.1.1.1")).toBe(false);
    expect(await serverError.verify("t", "1.1.1.1")).toBe(false);
    expect(await notJson.verify("t", "1.1.1.1")).toBe(false);
  });

  it("fails closed on a json body that is not an object", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const nullBody = unchecked(() => Promise.resolve(new Response("null")));
    const arrayBody = unchecked(() => Promise.resolve(new Response("[true]")));
    expect(await nullBody.verify("t", "1.1.1.1")).toBe(false);
    expect(await arrayBody.verify("t", "1.1.1.1")).toBe(false);
  });

  it("throws without secret", () => {
    expect(
      () => new TurnstileBotCheck({ secret: "", expectedHostnames: [], expectedAction: null }),
    ).toThrow();
  });

  it("logs a reason code and never the token or ip", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const bad = check({ success: true, hostname: "evil.example", action: "enter" });
    await bad.verify("secret-token-value", "1.1.1.1");
    expect(warn).toHaveBeenCalledWith("bot_check_failed", { reason: "hostname_mismatch" });
    expect(JSON.stringify(warn.mock.calls)).not.toContain("secret-token-value");
    expect(JSON.stringify(warn.mock.calls)).not.toContain("1.1.1.1");
  });
});
