import { applyD1Migrations, type D1Migration } from "cloudflare:test";
import { env } from "cloudflare:workers";
import { inject } from "vitest";

declare module "vitest" {
  interface ProvidedContext {
    d1Migrations: D1Migration[];
  }
}

await applyD1Migrations(env.DB, inject("d1Migrations"));
