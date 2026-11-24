import { LIMITS } from "@shared/config";
import { runInDurableObject } from "cloudflare:test";
import { env } from "cloudflare:workers";
import { beforeEach, expect, it } from "vitest";
import { resetLobby } from "../test/helpers";
import { ContactRejectionCounter, createStrikeTracker, DuplicateTextDetector } from "./abuse";
import { lobbyStub } from "./lobbyStub";

beforeEach(resetLobby);

it("StrikeTracker kicks on 3rd strike in 10 minutes and survives a new instance", async () => {
  await runInDurableObject(lobbyStub(env), (_instance, state) => {
    const first = createStrikeTracker(state.storage.sql);
    expect(first.strike("u1", 0)).toBe(false);
    expect(first.strike("u1", 1)).toBe(false);
    const second = createStrikeTracker(state.storage.sql);
    expect(second.strike("u2", 2)).toBe(false);
    expect(second.strike("u1", 3)).toBe(true);
  });
});

it("StrikeTracker forgets strikes older than the window", async () => {
  await runInDurableObject(lobbyStub(env), (_instance, state) => {
    const tracker = createStrikeTracker(state.storage.sql);
    const { windowMs } = LIMITS.strikesForKick;
    expect(tracker.strike("u1", 0)).toBe(false);
    expect(tracker.strike("u1", 5)).toBe(false);
    expect(tracker.strike("u1", windowMs + 1)).toBe(false);
    expect(tracker.strike("u1", windowMs + 2)).toBe(true);
  });
});

it("ContactRejectionCounter calls every 3rd rejection in 10 minutes a strike", async () => {
  await runInDurableObject(lobbyStub(env), (_instance, state) => {
    const counter = new ContactRejectionCounter(state.storage.sql);
    const { windowMs } = LIMITS.contactRejectionsForStrike;
    expect([0, 1, 2, 3, 4, 5].map((at) => counter.reject("u1", at))).toEqual([
      false,
      false,
      true,
      false,
      false,
      true,
    ]);
    expect(counter.reject("u2", 10)).toBe(false);
    expect(new ContactRejectionCounter(state.storage.sql).reject("u2", windowMs + 5)).toBe(false);
    expect(counter.reject("u2", windowMs + 11)).toBe(false);
    expect(counter.reject("u2", windowMs + 12)).toBe(true);
  });
});

it("DuplicateTextDetector flags same text to 5 different users in a minute", () => {
  const d = new DuplicateTextDetector(5, 60_000);
  expect(["r1", "r2", "r3", "r4", "r5"].map((r, i) => d.record("s", r, "h", i))).toEqual([
    false,
    false,
    false,
    false,
    true,
  ]);
  expect(d.record("s", "r1", "h", 10)).toBe(false);
});

it("DuplicateTextDetector ignores repeats to one user, other texts and old sends", () => {
  const d = new DuplicateTextDetector(3, 1_000);
  expect(d.record("s", "r1", "h", 0)).toBe(false);
  expect(d.record("s", "r1", "h", 1)).toBe(false);
  expect(d.record("s", "r2", "other", 2)).toBe(false);
  expect(d.record("t", "r3", "h", 3)).toBe(false);
  expect(d.record("s", "r2", "h", 1_001)).toBe(false);
  expect(d.record("s", "r3", "h", 1_002)).toBe(false);
  expect(d.record("s", "r4", "h", 1_003)).toBe(true);
});
