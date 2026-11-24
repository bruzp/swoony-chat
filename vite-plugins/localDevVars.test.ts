import { describe, expect, it } from "vitest";
import { workerVarsFor } from "./localDevVars.ts";

describe("Worker settings for the local dev server", () => {
  it("relaxes the secure cookie and Turnstile hostname checks on the dev server", () => {
    expect(workerVarsFor("serve", [])).toMatchObject({
      DEV_INSECURE_COOKIES: "1",
      TURNSTILE_HOSTNAMES: "",
    });
  });

  it("signs the admin in as the local dev email on the dev server", () => {
    expect(workerVarsFor("serve", [])).toMatchObject({ ADMIN_DEV_EMAIL: "dev@localhost" });
  });

  it("never signs anyone in automatically when the dev server is open to the network", () => {
    const shared = workerVarsFor("serve", ["vite", "--host"]);
    expect(shared).not.toHaveProperty("ADMIN_DEV_EMAIL");
    expect(shared).toMatchObject({ DEV_INSECURE_COOKIES: "1" });
    expect(workerVarsFor("serve", ["vite", "--host", "0.0.0.0"])).not.toHaveProperty(
      "ADMIN_DEV_EMAIL",
    );
  });

  it("adds nothing to a production build", () => {
    expect(workerVarsFor("build", [])).toEqual({});
  });
});
