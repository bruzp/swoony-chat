import { describe, expect, it } from "vitest";
import { clientIp, isSameOrigin, networkKey, requestCountry } from "./requestInfo";

describe("clientIp", () => {
  it("reads CF-Connecting-IP and falls back to localhost", () => {
    const withIp = new Request("http://x", { headers: { "CF-Connecting-IP": "1.2.3.4" } });
    expect(clientIp(withIp)).toBe("1.2.3.4");
    expect(clientIp(new Request("http://x"))).toBe("127.0.0.1");
  });
});

describe("networkKey", () => {
  it("groups IPv6 by /64 and keeps IPv4", () => {
    expect(networkKey("2001:db8:1:2:aaaa::1")).toBe(networkKey("2001:0db8:0001:0002:ffff:1:2:3"));
    expect(networkKey("2001:db8:1:2:aaaa::1")).toBe("2001:db8:1:2::/64");
    expect(networkKey("1.2.3.4")).toBe("1.2.3.4");
  });

  it("separates different /64 prefixes", () => {
    expect(networkKey("2001:db8:1:2::1")).not.toBe(networkKey("2001:db8:1:3::1"));
  });

  it("expands a leading :: and ignores case", () => {
    expect(networkKey("::1")).toBe("0:0:0:0::/64");
    expect(networkKey("2001:DB8:1:2::1")).toBe("2001:db8:1:2::/64");
  });

  it("treats IPv4-mapped IPv6 as IPv4", () => {
    expect(networkKey("::ffff:1.2.3.4")).toBe("1.2.3.4");
  });
});

describe("isSameOrigin", () => {
  const withOrigin = (origin?: string) =>
    new Request("https://swoony.chat/api/session", {
      headers: origin === undefined ? {} : { Origin: origin },
    });

  it("accepts the same host only", () => {
    expect(isSameOrigin(withOrigin("https://swoony.chat"))).toBe(true);
    expect(isSameOrigin(withOrigin("https://evil.example"))).toBe(false);
    expect(isSameOrigin(withOrigin("https://swoony.chat.evil.example"))).toBe(false);
  });

  it("rejects a missing, null or malformed Origin", () => {
    expect(isSameOrigin(withOrigin())).toBe(false);
    expect(isSameOrigin(withOrigin("null"))).toBe(false);
    expect(isSameOrigin(withOrigin("not a url"))).toBe(false);
  });
});

describe("requestCountry", () => {
  it("returns the cf country or null", () => {
    expect(requestCountry(new Request("http://x/", { cf: { country: "PH" } }))).toBe("PH");
    expect(requestCountry(new Request("http://x/"))).toBeNull();
  });
});
