import { describe, expect, it } from "vitest";
import { beaconTag, beaconTagFor } from "./analyticsBeacon.ts";

describe("Cloudflare Web Analytics beacon", () => {
  it("is left out when no token is configured", () => {
    expect(beaconTag("")).toEqual([]);
    expect(beaconTag(undefined)).toEqual([]);
  });

  it("adds the deferred beacon script with the token", () => {
    expect(beaconTag("abc123")).toEqual([
      {
        tag: "script",
        attrs: {
          defer: true,
          src: "https://static.cloudflareinsights.com/beacon.min.js",
          "data-cf-beacon": '{"token":"abc123"}',
        },
        injectTo: "body",
      },
    ]);
  });

  it("refuses a token that could break out of the attribute", () => {
    expect(() => beaconTag('x"}<script>')).toThrow(/token/);
  });

  it("is never added to the admin page", () => {
    expect(beaconTagFor("abc123", "/s-admin/index.html")).toEqual([]);
    expect(beaconTagFor("abc123", "/chat/index.html")).toHaveLength(1);
  });
});
