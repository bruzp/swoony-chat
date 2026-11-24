import { describe, expect, it } from "vitest";
import { isBlockedCountry } from "./config";
import { COUNTRY_CODES, countryName, isCountryCode } from "./countries";

describe("countries", () => {
  it("has PH and 240+ codes", () => {
    expect(isCountryCode("PH")).toBe(true);
    expect(COUNTRY_CODES.length).toBeGreaterThan(240);
  });

  it("rejects unknown and lower-case codes", () => {
    expect(isCountryCode("ZZ")).toBe(false);
    expect(isCountryCode("ph")).toBe(false);
  });

  it("names a country", () => {
    expect(countryName("PH", "en")).toBe("Philippines");
  });

  it("falls back to the code for non-country values like Tor's T1", () => {
    expect(countryName("T1")).toBe("T1");
  });

  it("falls back to English for an invalid locale", () => {
    expect(countryName("PH", "not a locale!")).toBe("Philippines");
  });
});

describe("isBlockedCountry", () => {
  it("blocks only listed countries", () => {
    expect(isBlockedCountry("GB")).toBe(true);
    expect(isBlockedCountry("PH")).toBe(false);
    expect(isBlockedCountry(null)).toBe(false);
    expect(isBlockedCountry(undefined)).toBe(false);
  });
});
