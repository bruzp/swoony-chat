import { describe, expect, it } from "vitest";
import { formatPht, utcDate } from "./time";

describe("legal times", () => {
  it("shows Philippine time as UTC+8", () => {
    expect(formatPht(Date.UTC(2026, 10, 19, 20, 5, 3))).toBe("2026-11-20 04:05:03 PHT");
    expect(utcDate(Date.UTC(2026, 10, 19, 20))).toBe("2026-11-19");
  });
});

describe("formatPht at the edge of time", () => {
  it("does not throw for the latest possible date", () => {
    expect(formatPht(8_640_000_000_000_000)).toMatch(/PHT$/);
  });
});
