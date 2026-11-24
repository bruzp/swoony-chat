import { describe, expect, it } from "vitest";
import { matchesFilter, nicknameKey, profileSchema, userFilterSchema } from "./profile";

const valid = { nickname: "Mika_24", gender: "female", age: 24, country: "PH", bio: "" };

describe("profileSchema", () => {
  it("accepts a valid profile", () => {
    expect(profileSchema.safeParse(valid).success).toBe(true);
  });

  it.each(["ab", "a".repeat(21), "has space", "emoji😀"])("rejects nickname %s", (nickname) => {
    expect(profileSchema.safeParse({ ...valid, nickname }).success).toBe(false);
  });

  it("rejects non-ascii nickname", () => {
    expect(profileSchema.safeParse({ ...valid, nickname: "Mіka" }).success).toBe(false);
  });

  it.each([17, 100, 24.5])("rejects age %s", (age) => {
    expect(profileSchema.safeParse({ ...valid, age }).success).toBe(false);
  });

  it("rejects unknown gender and country", () => {
    expect(profileSchema.safeParse({ ...valid, gender: "x" }).success).toBe(false);
    expect(profileSchema.safeParse({ ...valid, country: "ZZ" }).success).toBe(false);
  });

  it("rejects bio over 150 chars", () => {
    expect(profileSchema.safeParse({ ...valid, bio: "a".repeat(151) }).success).toBe(false);
  });

  it("defaults bio to empty", () => {
    const withoutBio = {
      nickname: valid.nickname,
      gender: valid.gender,
      age: valid.age,
      country: valid.country,
    };
    expect(profileSchema.parse(withoutBio).bio).toBe("");
  });
});

describe("nicknameKey", () => {
  it("is case-insensitive", () => {
    expect(nicknameKey("MiKa")).toBe(nicknameKey("mika"));
  });
});

describe("matchesFilter", () => {
  it("applies gender, age range and countries", () => {
    const profile = profileSchema.parse(valid);
    expect(
      matchesFilter(profile, { genders: ["female"], minAge: 20, maxAge: 30, countries: ["PH"] }),
    ).toBe(true);
    expect(matchesFilter(profile, { genders: ["male"] })).toBe(false);
    expect(matchesFilter(profile, { maxAge: 23 })).toBe(false);
    expect(matchesFilter(profile, { countries: ["US"] })).toBe(false);
    expect(matchesFilter(profile, {})).toBe(true);
  });
});

describe("userFilterSchema", () => {
  it("accepts an empty filter and rejects out-of-range ages or unknown values", () => {
    expect(userFilterSchema.safeParse({}).success).toBe(true);
    expect(userFilterSchema.safeParse({ minAge: 17 }).success).toBe(false);
    expect(userFilterSchema.safeParse({ genders: ["x"] }).success).toBe(false);
    expect(userFilterSchema.safeParse({ countries: ["ZZ"] }).success).toBe(false);
  });
});
