import { LIMITS } from "@shared/config";
import { moderateText } from "@shared/text/moderateText";

export const BIO_NOT_ALLOWED = "Your bio can't include links, contact details or rude words.";

export function bioError(bio: string): string | undefined {
  const result = moderateText(bio, LIMITS.bioMax);
  if (result.ok || result.reason === "empty") return undefined;
  if (result.reason === "too_long") {
    return `Keep your bio under ${String(LIMITS.bioMax)} characters.`;
  }
  return BIO_NOT_ALLOWED;
}
