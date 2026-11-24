import { LINK_TLD_PATTERN, revealDisguisedDots } from "./links";
import { normalizeForChecks } from "./normalize";

const MIN_PHONE_DIGITS = 7;
const SOCIAL_CUE_WINDOW_WORDS = 4;

const DIGIT_WORDS: Readonly<Record<string, string>> = {
  zero: "0",
  oh: "0",
  one: "1",
  two: "2",
  three: "3",
  four: "4",
  five: "5",
  six: "6",
  seven: "7",
  eight: "8",
  nine: "9",
};
const SPELLED_DIGIT = new RegExp(`\\b(?:${Object.keys(DIGIT_WORDS).join("|")})\\b`, "g");
const PHONE_SEPARATORS = new Set([".", "-", "_", "(", ")", "+"]);

const BRACKETED_AT = /\s*[([{]\s*at\s*[)\]}]\s*/g;
const SPOKEN_AT_BEFORE_DOMAIN = /(?<=\w)\s+at\s+(?=[a-z0-9-]+\s*\.\s*[a-z])/g;
const SPACED_AT = /\s*@\s*/g;
const EMAIL = new RegExp(
  `[a-z0-9._%+-]+@[a-z0-9-]+(?:\\.[a-z0-9-]+)*(?:\\.[a-z]{2,}|\\s*\\.\\s*(?:${LINK_TLD_PATTERN})\\b)`,
);

const AT_HANDLE = /(?:^|[^\w.@])@[a-z0-9_][a-z0-9_.]{2,}/;

const STRONG_PLATFORMS = new Set([
  "instagram",
  "ig",
  "insta",
  "telegram",
  "tg",
  "whatsapp",
  "viber",
  "facebook",
  "fb",
  "messenger",
  "snapchat",
  "snap",
  "kik",
  "discord",
  "wechat",
  "tiktok",
  "twitter",
  "x.com",
  "onlyfans",
]);
const AMBIGUOUS_PLATFORMS = new Set(["wa", "sc", "line", "signal"]);
const HANDLE_ONLY_PLATFORMS = new Set(["of"]);

const STRONG_CUES_BEFORE = new Set(["add", "dm", "pm", "msg", "message", "hmu", "follow"]);
const WEAK_CUES_BEFORE = new Set(["my"]);
const CUES_RIGHT_AFTER = new Set(["me", "id", "user", "username", "handle", "acc", "account"]);

const HANDLE_LIKE = /^@?(?=.*[a-z])(?=.*[0-9_.])[a-z0-9_.]{3,}$/;
const EDGE_PUNCTUATION = /^[^a-z0-9@_]+|[^a-z0-9_]+$/g;

interface Word {
  text: string;
  endsWithColon: boolean;
}

export function containsPhoneNumber(text: string): boolean {
  return phoneNumberIn(normalizeForChecks(text));
}

function phoneNumberIn(normalized: string): boolean {
  const candidate = normalized.replace(SPELLED_DIGIT, (word) => DIGIT_WORDS[word] ?? word);
  let digits = 0;
  for (const character of candidate) {
    if (character >= "0" && character <= "9") {
      digits += 1;
      if (digits >= MIN_PHONE_DIGITS) return true;
    } else if (!PHONE_SEPARATORS.has(character) && !/\s/.test(character)) {
      digits = 0;
    }
  }
  return false;
}

export function containsEmail(text: string): boolean {
  return emailIn(normalizeForChecks(text));
}

function emailIn(normalized: string): boolean {
  const candidate = revealDisguisedDots(normalized)
    .replace(BRACKETED_AT, "@")
    .replace(SPOKEN_AT_BEFORE_DOMAIN, "@")
    .replace(SPACED_AT, "@");
  return EMAIL.test(candidate);
}

export function containsSocialHandle(text: string): boolean {
  return socialHandleIn(normalizeForChecks(text));
}

function socialHandleIn(normalized: string): boolean {
  if (AT_HANDLE.test(normalized)) return true;
  const words = toWords(normalized);
  return words.some((word, index) => isContactMovingPhrase(words, index, word));
}

export function containsContactDetails(text: string): boolean {
  return contactDetailsIn(normalizeForChecks(text));
}

export function contactDetailsIn(normalized: string): boolean {
  return phoneNumberIn(normalized) || emailIn(normalized) || socialHandleIn(normalized);
}

function toWords(normalized: string): Word[] {
  return normalized
    .split(/\s+/)
    .map((raw) => ({ text: raw.replace(EDGE_PUNCTUATION, ""), endsWithColon: raw.endsWith(":") }))
    .filter((word) => word.text.length > 0);
}

function isContactMovingPhrase(words: Word[], index: number, platform: Word): boolean {
  const isStrong = STRONG_PLATFORMS.has(platform.text);
  const isAmbiguous = AMBIGUOUS_PLATFORMS.has(platform.text);
  if (!isStrong && !isAmbiguous && !HANDLE_ONLY_PLATFORMS.has(platform.text)) return false;

  const before = words.slice(Math.max(0, index - SOCIAL_CUE_WINDOW_WORDS), index);
  const after = words.slice(index + 1, index + 1 + SOCIAL_CUE_WINDOW_WORDS);
  const hasHandleAfter = after.some((word) => HANDLE_LIKE.test(word.text));
  if (hasHandleAfter) return true;
  if (!isStrong && !isAmbiguous) return false;

  const hasStrongCueBefore = before.some(
    (word, offset) =>
      STRONG_CUES_BEFORE.has(word.text) ||
      (word.text === "on" && before[offset - 1]?.text === "me"),
  );
  const hasCueRightAfter = after[0] !== undefined && CUES_RIGHT_AFTER.has(after[0].text);
  if (hasStrongCueBefore || hasCueRightAfter || platform.endsWithColon) return true;

  return isStrong && before.some((word) => WEAK_CUES_BEFORE.has(word.text));
}
