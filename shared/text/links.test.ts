import { describe, expect, it } from "vitest";
import { containsLink } from "./links";

describe("containsLink", () => {
  it.each([
    "visit http://x.io",
    "https://a.b",
    "www.site.net",
    "go to mysite.com",
    "mysite dot com",
    "mysite (dot) com",
    "mysite[.]net",
    "mysite[dot]org",
    "SITE.COM",
    "ｓｉｔｅ．ｃｏｍ",
    "mysite。com",
    "mysite｡com",
    "mysite·com",
    "mysite . com",
  ])("detects link: %s", (text) => {
    expect(containsLink(text)).toBe(true);
  });

  it.each([
    "hello there",
    "I'm 24.5 years",
    "ok...sure",
    "e.g. this",
    "3.14",
    "lol.",
    "done. Is it ok?",
    "ok.so what",
    "I'm in. at home",
    "me.to",
    "nice to meet you",
    "same. me too",
    "ok .me",
  ])("allows: %s", (text) => {
    expect(containsLink(text)).toBe(false);
  });
});

describe("containsLink performance", () => {
  it("stays fast on long hyphenated input", () => {
    const started = performance.now();
    containsLink("a-".repeat(500));
    expect(performance.now() - started).toBeLessThan(25);
  });
});
