import { describe, expect, it } from "vitest";
import { containsProfanity, isCleanNickname } from "./profanity";

describe("containsProfanity", () => {
  it.each([
    "fuck",
    "f u c k",
    "fuuuck",
    "pussy",
    "dick",
    "sh1t",
    "send nudes",
    "so horny",
    "sex chat?",
    "n u d e s",
    "phuck off",
    "phuk u",
    "send n00dz",
    "noods pls",
    "nudez",
  ])("blocks %s", (text) => {
    expect(containsProfanity(text)).toBe(true);
  });

  it.each([
    "hello",
    "Scunthorpe",
    "assessment",
    "cumulative",
    "Dickens",
    "gago",
    "putangina",
    "Phuket trip",
    "noodles",
  ])("allows %s", (text) => {
    expect(containsProfanity(text)).toBe(false);
  });
});

describe("isCleanNickname", () => {
  it("rejects contact details and sexual terms", () => {
    expect(isCleanNickname("mika_ig")).toBe(true);
    expect(isCleanNickname("horny_guy")).toBe(false);
    expect(isCleanNickname("09171234567")).toBe(false);
  });
});

describe("extra sexual terms", () => {
  it.each([
    "jerk off",
    "jerkoff",
    "jerk-off",
    "nude pics",
    "sexting",
    "boobs",
    "tits",
    "blowjob",
    "handjob",
    "nsfw",
    "fap",
    "bj",
    "milf",
    "dtf",
    "send pics",
    "cam show",
    "cum",
  ])("blocks %s", (text) => {
    expect(containsProfanity(text)).toBe(true);
  });

  it.each(["what a jerk often", "titanic"])("allows %s", (text) => {
    expect(containsProfanity(text)).toBe(false);
  });
});
