import type { LegalQuery } from "@shared/legal/records";

const USER_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const PHT_OFFSET_MS = 8 * 60 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;
const DATE_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;

export function phtDayStart(date: string): number | null {
  const match = DATE_PATTERN.exec(date);
  if (!match) return null;
  const [, year, month, day] = match.map(Number);
  if (year === undefined || month === undefined || day === undefined) return null;
  return Date.UTC(year, month - 1, day) - PHT_OFFSET_MS;
}

export function phtDateInput(at: number): string {
  return new Date(at + PHT_OFFSET_MS).toISOString().slice(0, 10);
}

export function buildQuery(who: string, fromDate: string, toDate: string): LegalQuery | null {
  const from = phtDayStart(fromDate);
  const toStart = phtDayStart(toDate);
  if (from === null || toStart === null || toStart < from) return null;
  const range = { from, to: toStart + DAY_MS - 1 };
  const text = who.trim();
  if (!text) return range;
  return USER_ID_PATTERN.test(text) ? { userId: text, ...range } : { nickname: text, ...range };
}

export const ONE_YEAR_MS = 365 * DAY_MS;
