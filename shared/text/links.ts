import { COUNTRY_CODES } from "../countries";
import { normalizeForChecks } from "./normalize";

const GENERIC_TLDS = [
  "com",
  "net",
  "org",
  "io",
  "co",
  "app",
  "dev",
  "chat",
  "me",
  "xyz",
  "info",
  "biz",
  "online",
  "site",
  "live",
  "link",
  "club",
  "top",
  "shop",
  "store",
  "tv",
  "gg",
  "ly",
];

const COUNTRY_CODES_THAT_ARE_COMMON_WORDS = new Set([
  "at",
  "be",
  "by",
  "do",
  "go",
  "he",
  "hi",
  "id",
  "if",
  "in",
  "is",
  "it",
  "me",
  "my",
  "no",
  "of",
  "oh",
  "ok",
  "on",
  "or",
  "so",
  "to",
  "up",
  "us",
  "we",
]);

const LINK_TLDS = [
  ...new Set([
    ...GENERIC_TLDS,
    ...COUNTRY_CODES.map((code) => code.toLowerCase()).filter(
      (code) => !COUNTRY_CODES_THAT_ARE_COMMON_WORDS.has(code),
    ),
  ]),
];

const BRACKETED_DOT = /\s*[([{]\s*(?:dot|\.)\s*[)\]}]\s*/g;
const SPOKEN_DOT = /(?<=\w)\s+dot\s+(?=\w)/g;
const SPACED_DOT = /(?<=\w)\s+\.\s+(?=\w)/g;
const SCHEME_OR_WWW = /https?:\/\/|\bwww\./;
export const LINK_TLD_PATTERN = LINK_TLDS.join("|");
const BARE_DOMAIN = new RegExp(`\\b(?=[a-z0-9-]*[a-z])[a-z0-9-]+\\.(?:${LINK_TLD_PATTERN})\\b`);

export function revealDisguisedDots(normalizedText: string): string {
  return normalizedText
    .replace(BRACKETED_DOT, ".")
    .replace(SPOKEN_DOT, ".")
    .replace(SPACED_DOT, ".");
}

export function containsLink(text: string): boolean {
  return linkIn(normalizeForChecks(text));
}

export function linkIn(normalized: string): boolean {
  const candidate = revealDisguisedDots(normalized);
  return SCHEME_OR_WWW.test(candidate) || BARE_DOMAIN.test(candidate);
}
