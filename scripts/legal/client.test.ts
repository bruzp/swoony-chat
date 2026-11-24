import { describe, expect, it } from "vitest";
import { adminBaseUrl, toTimestamp } from "./client.ts";

describe("toTimestamp", () => {
  it("reads a date alone as the start of that day, or its end for range ends", () => {
    expect(toTimestamp("2026-11-19", "from")).toBe(Date.UTC(2026, 10, 19));
    expect(toTimestamp("2026-11-19", "to", { endOfDay: true })).toBe(Date.UTC(2026, 10, 20) - 1);
  });

  it("keeps an explicit time as given", () => {
    expect(toTimestamp("2026-11-19T08:00Z", "to", { endOfDay: true })).toBe(
      Date.UTC(2026, 10, 19, 8),
    );
  });

  it("rejects text that is not a date", () => {
    expect(() => toTimestamp("yesterday", "from")).toThrow(/--from/);
  });
});

describe("adminBaseUrl", () => {
  it("accepts https and strips trailing slashes", () => {
    expect(adminBaseUrl("https://swoony.chat//")).toBe("https://swoony.chat");
  });

  it("allows plain http only for localhost", () => {
    expect(adminBaseUrl("http://localhost:5173")).toBe("http://localhost:5173");
    expect(adminBaseUrl("http://127.0.0.1:8787/")).toBe("http://127.0.0.1:8787");
    expect(() => adminBaseUrl("http://swoony.chat")).toThrow(/https/);
    expect(() => adminBaseUrl("not a url")).toThrow(/https/);
  });
});
