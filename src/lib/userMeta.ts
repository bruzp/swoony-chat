import { countryName } from "@shared/countries";
import type { Gender, Profile } from "@shared/profile";

export const GENDER_LABELS: Record<Gender, string> = {
  male: "Male",
  female: "Female",
  other: "Other",
};

export function longMeta(user: Profile): string {
  return `${GENDER_LABELS[user.gender]} · ${String(user.age)} · ${countryName(user.country)}`;
}
