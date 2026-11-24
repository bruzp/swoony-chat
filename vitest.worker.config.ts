import { cloudflareTest, readD1Migrations } from "@cloudflare/vitest-plugin";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";
import { aliases } from "./paths.ts";

const d1Migrations = await readD1Migrations(
  fileURLToPath(new URL("./migrations", import.meta.url)),
);

export default defineConfig({
  plugins: [
    cloudflareTest({
      wrangler: { configPath: "./wrangler.jsonc" },
      miniflare: {
        bindings: {
          ALLOW_TEST_RESET: "1",
          COOKIE_SECRETS: "test-only-cookie-secret-0123456789abcdef",
          IDENTITY_HASH_SECRET: "test-only-hash-secret-0123456789abcdef",
          TURNSTILE_SECRET: "test",
          RETENTION_KEY: "AAECAwQFBgcICQoLDA0ODxAREhMUFRYXGBkaGxwdHh8=",
          ADMIN_TOKEN: "test-only-admin-token-0123456789abcdef",
          RETAIN_ALL_CONTENT: "false",
          ACCESS_TEAM_DOMAIN: "https://swoony-test.cloudflareaccess.com",
          ACCESS_AUD: "test-aud-tag",
          ADMIN_EMAILS: "owner@example.com",
          ADMIN_DEV_EMAIL: "",
          ALERT_EMAIL_FROM: "",
          ALERT_EMAIL_TO: "",
        },
      },
    }),
  ],

  resolve: { alias: aliases },
  test: {
    include: ["worker/**/*.test.ts"],
    deps: { optimizer: { ssr: { enabled: true, include: ["obscenity"] } } },
    provide: { d1Migrations },
    setupFiles: ["./worker/test/applyMigrations.ts"],
  },
});
