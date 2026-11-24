import { expect, it } from "vitest";
import { adminPage, adminToken, webAdminCall } from "../test/adminAccess";

const EXPECTED = {
  "Cache-Control": "no-store",
  "X-Robots-Tag": "noindex, nofollow",
  "X-Frame-Options": "DENY",
  "Referrer-Policy": "no-referrer",
  "X-Content-Type-Options": "nosniff",
};

function expectLockedDown(res: Response): void {
  for (const [name, value] of Object.entries(EXPECTED)) {
    expect(res.headers.get(name), name).toBe(value);
  }
  const csp = res.headers.get("Content-Security-Policy") ?? "";
  expect(csp).toContain("default-src 'self'");
  expect(csp).toContain("script-src 'self'");
  expect(csp).toContain("frame-ancestors 'none'");
  expect(csp).toContain("object-src 'none'");
  expect(csp).not.toContain("cloudflareinsights");
  expect(csp).not.toContain("challenges.cloudflare.com");
}

it("locks down the admin page", async () => {
  expectLockedDown(await adminPage("/s-admin/", await adminToken()));
});

it("locks down the admin page's hidden 404 too", async () => {
  expectLockedDown(await adminPage("/s-admin/", null));
});

it("locks down admin API answers", async () => {
  expectLockedDown(await webAdminCall("holds"));
  expectLockedDown(await webAdminCall("holds", {}, { token: null }));
});

it("does not add admin headers to public API answers", async () => {
  const { handleRequest } = await import("../app");
  const { env } = await import("cloudflare:workers");
  const { deps, ORIGIN } = await import("../test/helpers");
  const res = await handleRequest(new Request(`${ORIGIN}/api/health`), env, deps);
  expect(res.headers.get("X-Robots-Tag")).toBeNull();
});

it("lets the local dev server run its inline hot-reload script, and nothing else does", async () => {
  const { handleRequest } = await import("../app");
  const { adminDeps, adminEnv } = await import("../test/adminAccess");
  const devEnv = { ...adminEnv, ADMIN_DEV_EMAIL: "dev@localhost", DEV_INSECURE_COOKIES: "1" };
  const page = (url: string, appEnv: Env) =>
    handleRequest(new Request(url), appEnv, adminDeps).then(
      (res) => res.headers.get("Content-Security-Policy") ?? "",
    );
  expect(await page("http://localhost:5173/s-admin/", devEnv)).toContain(
    "script-src 'self' 'unsafe-inline'",
  );
  expect(await page("https://swoony.chat/s-admin/", devEnv)).toContain("script-src 'self';");
  expect(await page("http://localhost:5173/s-admin/", adminEnv)).toContain("script-src 'self';");
});
