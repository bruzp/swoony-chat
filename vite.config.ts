import { cloudflare } from "@cloudflare/vite-plugin";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig, loadEnv } from "vite";
import { aliases } from "./paths.ts";
import { analyticsBeacon } from "./vite-plugins/analyticsBeacon.ts";
import { emojibaseData } from "./vite-plugins/emojibaseData.ts";
import { workerVarsFor } from "./vite-plugins/localDevVars.ts";

const ADMIN_SOURCES = ["/s-admin/", "/src/admin/"];
const ADMIN_ASSETS = "s-admin/assets/[name]-[hash].js";
const PUBLIC_ASSETS = "assets/[name]-[hash].js";

function isAdminModule(id: string | null | undefined): boolean {
  const path = (id ?? "").replaceAll("\\", "/");
  return ADMIN_SOURCES.some((source) => path.includes(source));
}

function adminOnly(chunk: { facadeModuleId: string | null; moduleIds: readonly string[] }) {
  return chunk.facadeModuleId
    ? isAdminModule(chunk.facadeModuleId)
    : chunk.moduleIds.length > 0 && chunk.moduleIds.every(isAdminModule);
}

const PAGES = [
  "index.html",
  "chat/index.html",
  "terms/index.html",
  "privacy/index.html",
  "safety/index.html",
  "faq/index.html",
  "unavailable/index.html",
  "404.html",
  "s-admin/index.html",
];

export default defineConfig(({ command, mode }) => {
  const env = loadEnv(mode, process.cwd(), "VITE_");
  return {
    plugins: [
      emojibaseData(),
      analyticsBeacon(env.VITE_CF_ANALYTICS_TOKEN),
      react(),
      tailwindcss(),
      cloudflare({
        config: (worker) => ({
          vars: { ...worker.vars, ...workerVarsFor(command, process.argv) },
        }),
      }),
    ],
    resolve: { alias: aliases },
    server: { allowedHosts: [".trycloudflare.com"] },
    build: {
      assetsInlineLimit: (filePath: string) =>
        filePath.endsWith(".woff2") || filePath.includes("country-flag-icons") ? false : undefined,
    },
    environments: {
      client: {
        build: {
          rolldownOptions: {
            input: PAGES,
            output: {
              entryFileNames: (chunk) => (adminOnly(chunk) ? ADMIN_ASSETS : PUBLIC_ASSETS),
              chunkFileNames: (chunk) => (adminOnly(chunk) ? ADMIN_ASSETS : PUBLIC_ASSETS),
            },
          },
        },
      },
    },
  };
});
