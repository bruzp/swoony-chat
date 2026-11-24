import { parseArgs, type ParseArgsOptionsConfig } from "node:util";

export type AdminAction = "lookup" | "ban" | "takedown" | "hold";

function requiredEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Set ${name} in your shell first (never put it in the repo).`);
  return value;
}

export function readOptions<T extends ParseArgsOptionsConfig>(options: T, usage: string) {
  try {
    return parseArgs({ options, strict: true }).values;
  } catch {
    throw new Error(usage);
  }
}

const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;
const DAY_MS = 86_400_000;
const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]"]);

export function toTimestamp(value: string, name: string, { endOfDay = false } = {}): number {
  const at = Date.parse(value);
  if (Number.isNaN(at)) {
    throw new Error(`--${name} must be a date like 2026-11-19 or 2026-11-19T08:00Z`);
  }
  return endOfDay && DATE_ONLY.test(value) ? at + DAY_MS - 1 : at;
}

function isAllowedAdminUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === "https:" || (url.protocol === "http:" && LOCAL_HOSTS.has(url.hostname));
  } catch {
    return false;
  }
}

export function adminBaseUrl(value: string): string {
  if (!isAllowedAdminUrl(value)) {
    throw new Error("SWOONY_ADMIN_URL must start with https:// (http only for localhost)");
  }
  return value.replace(/\/+$/, "");
}

function isNoRecord(result: unknown): boolean {
  return (
    typeof result === "object" &&
    result !== null &&
    "error" in result &&
    result.error === "no_record"
  );
}

export async function callAdmin(action: AdminAction, body: object): Promise<unknown> {
  const baseUrl = adminBaseUrl(requiredEnv("SWOONY_ADMIN_URL"));
  const token = requiredEnv("SWOONY_ADMIN_TOKEN");
  const response = await fetch(`${baseUrl}/api/admin/${action}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: JSON.stringify(body),
  });
  const result: unknown = await response.json().catch(() => null);
  if (response.status === 404 && !isNoRecord(result)) {
    throw new Error(
      "Not found: check SWOONY_ADMIN_URL and SWOONY_ADMIN_TOKEN, or wait a minute (limit 10 calls / min per network).",
    );
  }
  if (!response.ok && response.status !== 404) {
    throw new Error(`Request failed with ${String(response.status)}: ${JSON.stringify(result)}`);
  }
  return result;
}

export function printJson(value: unknown): void {
  process.stdout.write(`${JSON.stringify(value, null, 2)}\n`);
}

export async function runCli(main: () => Promise<void>): Promise<void> {
  try {
    await main();
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  }
}
