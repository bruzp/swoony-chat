import { env } from "cloudflare:workers";
import { expect, it } from "vitest";
import { handleRequest } from "./app";
import { createDeps } from "./deps";

const deps = createDeps(env, () => 0);

it("GET /api/health returns ok", async () => {
  const res = await handleRequest(new Request("http://localhost/api/health"), env, deps);
  expect(res.status).toBe(200);
  expect(await res.json()).toEqual({ status: "ok" });
});

it("unknown /api route returns 404 json", async () => {
  const res = await handleRequest(new Request("http://localhost/api/nope"), env, deps);
  expect(res.status).toBe(404);
  expect(await res.json()).toEqual({ error: "not_found" });
});

it("API responses are never cached or sniffed", async () => {
  for (const path of ["/api/health", "/api/nope", "/api/session"]) {
    const res = await handleRequest(new Request(`http://localhost${path}`), env, deps);
    expect(res.headers.get("Cache-Control")).toBe("no-store");
    expect(res.headers.get("X-Content-Type-Options")).toBe("nosniff");
  }
});

it("a refused chat upgrade also carries the API headers", async () => {
  const res = await handleRequest(
    new Request(`http://localhost/api/chat/${"a".repeat(64)}`, {
      headers: { Upgrade: "websocket", Origin: "http://localhost" },
    }),
    env,
    deps,
  );
  expect(res.status).toBeGreaterThanOrEqual(400);
  expect(res.headers.get("X-Content-Type-Options")).toBe("nosniff");
  expect(res.headers.get("Cache-Control")).toBe("no-store");
});
