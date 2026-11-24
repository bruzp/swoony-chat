import type { ModerationRejection } from "@shared/text/moderateText";
import type { SendFailure } from "@/app/store";

const FAILURE_COPY: Record<SendFailure, string> = {
  empty: "Type a message first.",
  link: "Links aren't allowed in chats.",
  contact: "For your safety, sharing contact details isn't allowed.",
  profanity: "Let's keep it friendly.",
  too_long: "That message is too long.",
  slow_down: "Slow down a bit.",
  spam: "That looks like spam.",
  not_sent: "Not sent. Tap to retry",
};

export function failureCopy(reason: SendFailure | ModerationRejection): string {
  return FAILURE_COPY[reason];
}
