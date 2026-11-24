import { describe, expect, it } from "vitest";
import { DEVICE_COOKIE, DeviceCookies } from "./deviceCookie";
import { flipCharacterNearEnd } from "../test/tamper";

const SECRET = "x".repeat(32);
const OTHER_SECRET = "y".repeat(32);

function requestWithCookie(cookie: string): Request {
  return new Request("http://x", { headers: { Cookie: cookie } });
}

function cookiePair(setCookie: string): string {
  return setCookie.split(";")[0] ?? "";
}

describe("DeviceCookies", () => {
  it("round-trips a signed device id and verifies with a rotated-out secret", async () => {
    const old = new DeviceCookies([SECRET], true);
    const { deviceId, setCookie } = await old.issue();
    const req = requestWithCookie(cookiePair(setCookie));
    expect(await new DeviceCookies([OTHER_SECRET, SECRET], true).read(req)).toBe(deviceId);
  });

  it("rejects tampered and foreign-secret cookies", async () => {
    const cookies = new DeviceCookies([SECRET], true);
    const pair = cookiePair((await cookies.issue()).setCookie);
    const tampered = flipCharacterNearEnd(pair);
    expect(await cookies.read(requestWithCookie(tampered))).toBeNull();
    expect(await new DeviceCookies([OTHER_SECRET], true).read(requestWithCookie(pair))).toBeNull();
  });

  it("rejects a swapped device id under a valid signature", async () => {
    const cookies = new DeviceCookies([SECRET], true);
    const pair = cookiePair((await cookies.issue()).setCookie);
    const signature = pair.split(".")[1] ?? "";
    const forged = `${DEVICE_COOKIE}=${crypto.randomUUID()}.${signature}`;
    expect(await cookies.read(requestWithCookie(forged))).toBeNull();
  });

  it("returns null without a cookie or with a malformed value", async () => {
    const cookies = new DeviceCookies([SECRET], true);
    expect(await cookies.read(new Request("http://x"))).toBeNull();
    expect(await cookies.read(requestWithCookie(`${DEVICE_COOKIE}=garbage`))).toBeNull();
    expect(await cookies.read(requestWithCookie(`${DEVICE_COOKIE}=a.b.c`))).toBeNull();
    expect(await cookies.read(requestWithCookie("other=1"))).toBeNull();
  });

  it("finds the device cookie among other cookies", async () => {
    const cookies = new DeviceCookies([SECRET], true);
    const { deviceId, setCookie } = await cookies.issue();
    const req = requestWithCookie(`theme=dark; ${cookiePair(setCookie)}; other=1`);
    expect(await cookies.read(req)).toBe(deviceId);
  });

  it("reissues a given device id", async () => {
    const cookies = new DeviceCookies([SECRET], true);
    const deviceId = crypto.randomUUID();
    const issued = await cookies.issue(deviceId);
    expect(issued.deviceId).toBe(deviceId);
    expect(await cookies.read(requestWithCookie(cookiePair(issued.setCookie)))).toBe(deviceId);
  });

  it("rejects short secrets", () => {
    expect(() => new DeviceCookies(["short"], true)).toThrow();
    expect(() => new DeviceCookies([SECRET, "short"], true)).toThrow();
    expect(() => new DeviceCookies([], true)).toThrow();
  });

  it("adds Secure only when secure", async () => {
    expect((await new DeviceCookies([SECRET], true).issue()).setCookie).toMatch(
      /^sw_dev=[^;]+; HttpOnly; SameSite=Lax; Path=\/; Max-Age=31536000; Secure$/,
    );
    expect((await new DeviceCookies([SECRET], false).issue()).setCookie).not.toMatch(/Secure/);
  });
});
