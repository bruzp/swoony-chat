import { expect, it } from "vitest";
import type { Profile } from "@shared/profile";
import { longMeta } from "./userMeta";

function profile(gender: Profile["gender"]): Profile {
  return { nickname: "mika", gender, age: 25, country: "PH", bio: "" };
}

it("long details spell the gender out", () => {
  expect(longMeta(profile("female"))).toBe("Female · 25 · Philippines");
});
