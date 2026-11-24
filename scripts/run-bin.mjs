import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";

process.chdir(process.cwd().replace(/^[a-z]:/, (drive) => drive.toUpperCase()));

const [packageName, ...args] = process.argv.slice(2);
if (!packageName) throw new Error("Usage: node scripts/run-bin.mjs <package> [...args]");

const packageDir = join(process.cwd(), "node_modules", packageName);
const { bin } = JSON.parse(readFileSync(join(packageDir, "package.json"), "utf8"));
const binPath = typeof bin === "string" ? bin : bin[packageName];

const { status } = spawnSync(process.execPath, [join(packageDir, binPath), ...args], {
  stdio: "inherit",
});
process.exit(status ?? 1);
