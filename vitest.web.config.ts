import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";
import { aliases } from "./paths.ts";

export default defineConfig({
  plugins: [react()],
  resolve: { alias: aliases },
  test: {
    environment: "jsdom",
    include: [
      "src/**/*.test.{ts,tsx}",
      "shared/**/*.test.ts",
      "scripts/**/*.test.ts",
      "vite-plugins/**/*.test.ts",
    ],
    setupFiles: ["./src/test/setup.ts"],
  },
});
