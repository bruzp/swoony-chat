const PHT_OFFSET_MS = 8 * 60 * 60 * 1000;
const LATEST_DATE_MS = 8_640_000_000_000_000;

export function formatPht(at: number): string {
  const shifted = new Date(Math.min(at + PHT_OFFSET_MS, LATEST_DATE_MS)).toISOString();
  return `${shifted.slice(0, 10)} ${shifted.slice(11, 19)} PHT`;
}

export function formatUtc(at: number): string {
  return new Date(at).toISOString();
}

export function utcDate(at: number): string {
  return formatUtc(at).slice(0, 10);
}
