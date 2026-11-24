export function formatLocalDateTime(epochMs: number): string {
  return new Date(epochMs).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
}
