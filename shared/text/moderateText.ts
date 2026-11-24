import { contactDetailsIn } from "./contact";
import { linkIn } from "./links";
import { normalizeForChecks } from "./normalize";
import { profanityIn } from "./profanity";

export type ModerationRejection = "empty" | "too_long" | "link" | "contact" | "profanity";

export type ModerationResult =
  { ok: true; text: string } | { ok: false; reason: ModerationRejection };

const UNSAFE_FOR_DISPLAY = /(?!\n|\u200D|[\u{E0020}-\u{E007F}])[\p{Cc}\p{Cf}]/gu;
const LINE_SEPARATORS = /[\u2028\u2029]/g;
const BLANK_LINE_RUN = /\n(?:[^\S\n]*\n){2,}/g;

export function moderateText(text: string, maxLength: number): ModerationResult {
  const displayable = text
    .replace(UNSAFE_FOR_DISPLAY, "")
    .replace(LINE_SEPARATORS, "\n")
    .replace(BLANK_LINE_RUN, "\n\n")
    .trim();
  const normalized = normalizeForChecks(displayable);
  if (normalized.trim().length === 0) return { ok: false, reason: "empty" };
  if (Array.from(displayable).length > maxLength) return { ok: false, reason: "too_long" };
  if (contactDetailsIn(normalized)) return { ok: false, reason: "contact" };
  if (linkIn(normalized)) return { ok: false, reason: "link" };
  if (profanityIn(normalized)) return { ok: false, reason: "profanity" };
  return { ok: true, text: displayable };
}
