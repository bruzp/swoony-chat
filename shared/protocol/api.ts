import { z } from "zod";
import type { ProfileInput, PublicUser } from "../profile";
import type { ModerationRejection } from "../text/moderateText";

export interface ActiveBan {
  until: number;
}

export interface SessionBootstrap {
  me: PublicUser | null;
  suggestedCountry: string | null;
  ban: ActiveBan | null;
}

export type EnterRequest = ProfileInput & { confirmedAdult: true; turnstileToken: string };

export const entryConsentSchema = z.object({
  confirmedAdult: z.literal(true),
  turnstileToken: z.string(),
});

export interface EnterResponse {
  me: PublicUser;
}

export type ApiError =
  | { error: "region_unavailable" }
  | { error: "bad_origin" }
  | { error: "banned"; until: number }
  | { error: "invalid_profile"; field: string }
  | { error: "bad_nickname" }
  | { error: "bad_bio"; reason: ModerationRejection }
  | { error: "rate_limited" }
  | { error: "bot_check_failed" }
  | { error: "nickname_taken" }
  | { error: "no_session" }
  | { error: "upgrade_required" }
  | { error: "forbidden" }
  | { error: "not_found" }
  | { error: "maintenance"; message: string };
