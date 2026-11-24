import type { LegalRecords } from "./records";

const TIME_KEYS = new Set(["joinedAt", "leftAt", "startedAt", "endedAt", "createdAt", "sentAt"]);

function withUtcTimes(value: unknown, key?: string): unknown {
  if (key !== undefined && TIME_KEYS.has(key) && typeof value === "number") {
    return new Date(value).toISOString();
  }
  if (Array.isArray(value)) return value.map((item) => withUtcTimes(item));
  if (value !== null && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).map(([entryKey, entry]) => [entryKey, withUtcTimes(entry, entryKey)]),
    );
  }
  return value;
}

function sortedKeys(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortedKeys);
  if (value !== null && typeof value === "object") {
    return Object.fromEntries(
      Object.keys(value)
        .sort()
        .map((key) => [key, sortedKeys((value as Record<string, unknown>)[key])]),
    );
  }
  return value;
}

export function canonicalRecordsJson({ connections, chats, content }: LegalRecords): string {
  return JSON.stringify(sortedKeys(withUtcTimes({ connections, chats, content })));
}

export const FINGERPRINT_HOW_TO =
  "SHA-256 (hex) of the exported records as JSON: keys sorted, times as UTC ISO 8601, UTF-8, no spaces.";
