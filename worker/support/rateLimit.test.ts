import { runInDurableObject } from "cloudflare:test";
import { env } from "cloudflare:workers";
import { expect, it } from "vitest";
import { lobbyStub } from "../lobby/lobbyStub";
import { MemoryRateLimiter, SqlRateLimiter } from "./rateLimit";

it("MemoryRateLimiter allows count hits per window then blocks, then recovers", () => {
  const l = new MemoryRateLimiter(2, 1000);
  expect([l.hit("k", 0), l.hit("k", 10), l.hit("k", 20)]).toEqual([true, true, false]);
  expect(l.hit("k", 1011)).toBe(true);
});

it("MemoryRateLimiter keeps keys apart", () => {
  const l = new MemoryRateLimiter(1, 1000);
  expect([l.hit("a", 0), l.hit("b", 0), l.hit("a", 1)]).toEqual([true, true, false]);
});

it("SqlRateLimiter persists across instances", async () => {
  await runInDurableObject(lobbyStub(env), (_instance, state) => {
    const bucket = `test-${crypto.randomUUID()}`;
    const first = new SqlRateLimiter(state.storage.sql, bucket, 2, 1000);
    expect([first.hit("k", 0), first.hit("k", 10)]).toEqual([true, true]);
    const second = new SqlRateLimiter(state.storage.sql, bucket, 2, 1000);
    expect(second.hit("k", 20)).toBe(false);
    expect(second.hit("k", 1011)).toBe(true);
  });
});

it("SqlRateLimiter separates buckets and prunes expired events", async () => {
  await runInDurableObject(lobbyStub(env), (_instance, state) => {
    const bucket = `test-${crypto.randomUUID()}`;
    const limiter = new SqlRateLimiter(state.storage.sql, bucket, 1, 1000);
    const other = new SqlRateLimiter(state.storage.sql, `${bucket}-other`, 1, 1000);
    expect([limiter.hit("k", 0), other.hit("k", 0)]).toEqual([true, true]);
    limiter.prune(5000);
    const left = state.storage.sql
      .exec<{ n: number }>("SELECT COUNT(*) AS n FROM rate_events WHERE bucket = ?", bucket)
      .one();
    expect(left.n).toBe(0);
  });
});

it("MemoryRateLimiter forgets keys whose window has passed", () => {
  const l = new MemoryRateLimiter(1, 1000);
  l.hit("a", 0);
  l.hit("b", 1);
  l.hit("c", 2500);
  expect(l.size).toBe(1);
});
