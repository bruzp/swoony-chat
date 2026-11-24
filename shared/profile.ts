import { z } from "zod";
import { LIMITS } from "./config";
import { COUNTRY_CODES, isCountryCode } from "./countries";

export const GENDERS = ["male", "female", "other"] as const;
export type Gender = (typeof GENDERS)[number];

export interface Profile {
  nickname: string;
  gender: Gender;
  age: number;
  country: string;
  bio: string;
}

export type ProfileInput = Omit<Profile, "bio"> & { bio?: string | undefined };

export interface PublicUser extends Profile {
  userId: string;
}

export interface UserFilter {
  genders?: Gender[];
  minAge?: number;
  maxAge?: number;
  countries?: string[];
}

const genderSchema = z.enum(GENDERS);
const ageSchema = z.int().min(LIMITS.age.min).max(LIMITS.age.max);
const countrySchema = z.string().refine(isCountryCode, "Unknown country");

export const profileSchema: z.ZodType<Profile, ProfileInput> = z.object({
  nickname: z
    .string()
    .min(LIMITS.nickname.min)
    .max(LIMITS.nickname.max)
    .regex(LIMITS.nickname.pattern),
  gender: genderSchema,
  age: ageSchema,
  country: countrySchema,
  bio: z.string().max(LIMITS.bioMax).default(""),
});

export const userFilterSchema: z.ZodType<UserFilter> = z.object({
  genders: z.array(genderSchema).max(GENDERS.length).exactOptional(),
  minAge: ageSchema.exactOptional(),
  maxAge: ageSchema.exactOptional(),
  countries: z.array(countrySchema).max(COUNTRY_CODES.length).exactOptional(),
});

export function nicknameKey(nickname: string): string {
  return nickname.toLowerCase();
}

export function matchesFilter(user: Profile, filter: UserFilter): boolean {
  if (filter.genders?.length && !filter.genders.includes(user.gender)) return false;
  if (filter.minAge !== undefined && user.age < filter.minAge) return false;
  if (filter.maxAge !== undefined && user.age > filter.maxAge) return false;
  if (filter.countries?.length && !filter.countries.includes(user.country)) return false;
  return true;
}
