import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const config = readFileSync(resolve(process.cwd(), "wrangler.jsonc"), "utf8");
const required = /"required":\s*\[([^\]]*)\]/.exec(config)?.[1] ?? "";

describe("wrangler.jsonc", () => {
  it.each([
    "ACCESS_TEAM_DOMAIN",
    "ACCESS_AUD",
    "ADMIN_EMAILS",
    "ALERT_EMAIL_FROM",
    "ALERT_EMAIL_TO",
  ])("requires %s as a secret, so a deploy never blanks it and local dev loads it", (name) => {
    expect(required).toContain(`"${name}"`);
    expect(config).not.toContain(`"${name}":`);
  });

  it("never ships the local-only admin bypass", () => {
    expect(config).not.toContain("ADMIN_DEV_EMAIL");
  });
});
