import { expect, it } from "vitest";
import { adminPage, adminToken, servedAssets } from "../test/adminAccess";

it("serves the admin page to a signed-in admin", async () => {
  const res = await adminPage("/s-admin/", await adminToken());
  expect(res.status).toBe(200);
  expect(await res.text()).toContain("admin");
});

it.each(["/s-admin", "/s-admin/", "/s-admin/assets/index-abc.js"])(
  "hides %s without a sign-in behind the normal not-found page",
  async (path) => {
    const before = servedAssets.length;
    const res = await adminPage(path, null);
    expect(res.status).toBe(404);
    expect(await res.text()).toContain("Page not found");
    expect(servedAssets.slice(before)).not.toContain(path);
  },
);

it("hides the admin page from an email that is not allowed", async () => {
  const res = await adminPage("/s-admin/", await adminToken("stranger@example.com"));
  expect(res.status).toBe(404);
});

it("never lets the admin page be cached", async () => {
  const res = await adminPage("/s-admin/", await adminToken());
  expect(res.headers.get("Cache-Control")).toBe("no-store");
});
