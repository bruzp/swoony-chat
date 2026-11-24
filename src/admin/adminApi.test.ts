import { afterEach, describe, expect, it, vi } from "vitest";
import { AdminApiError, adminApi, SessionEndedError } from "./adminApi";

function serve(status: number, body: unknown) {
  vi.stubGlobal(
    "fetch",
    vi.fn(() => Promise.resolve(new Response(JSON.stringify(body), { status }))),
  );
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("adminApi errors", () => {
  it("reports a missing record as a readable error, not as a lost session", async () => {
    serve(404, { error: "no_record" });
    await expect(adminApi.ban("NBI-1", "u")).rejects.toMatchObject({
      name: "AdminApiError",
      code: "no_record",
    });
  });

  it("treats the hidden not-found answer as a lost session", async () => {
    serve(404, { error: "not_found" });
    await expect(adminApi.holds()).rejects.toBeInstanceOf(SessionEndedError);
  });

  it("treats a sign-in redirect as a lost session", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(() => Promise.resolve(Response.redirect("https://team.cloudflareaccess.com/", 302))),
    );
    await expect(adminApi.holds()).rejects.toBeInstanceOf(SessionEndedError);
  });

  it("passes other errors through with their code", async () => {
    serve(429, { error: "rate_limited" });
    await expect(adminApi.holds()).rejects.toBeInstanceOf(AdminApiError);
  });
});
