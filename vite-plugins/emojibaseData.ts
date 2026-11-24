import { readFileSync } from "node:fs";
import type { Plugin } from "vite";

export const EMOJIBASE_PUBLIC_PATH = "/emojibase";
const DATA_FILES = ["en/data.json", "en/messages.json"];

function readDataFile(file: string): Buffer {
  return readFileSync(new URL(`../node_modules/emojibase-data/${file}`, import.meta.url));
}

export function emojibaseData(): Plugin {
  return {
    name: "swoony-emojibase-data",
    configureServer(server) {
      server.middlewares.use((request, response, next) => {
        const file = DATA_FILES.find((name) => request.url === `${EMOJIBASE_PUBLIC_PATH}/${name}`);
        if (!file) {
          next();
          return;
        }
        response.setHeader("Content-Type", "application/json");
        response.end(readDataFile(file));
      });
    },
    applyToEnvironment(environment) {
      return environment.name === "client";
    },
    generateBundle() {
      for (const file of DATA_FILES) {
        this.emitFile({
          type: "asset",
          fileName: `${EMOJIBASE_PUBLIC_PATH.slice(1)}/${file}`,
          source: readDataFile(file),
        });
      }
    },
  };
}
