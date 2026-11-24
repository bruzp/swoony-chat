import { describe, expect, it } from "vitest";
import {
  containsContactDetails,
  containsEmail,
  containsPhoneNumber,
  containsSocialHandle,
} from "./contact";

describe("containsPhoneNumber", () => {
  it.each([
    "09171234567",
    "0917 123 4567",
    "0917-123-4567",
    "+63 917 123 4567",
    "(02) 8123 4567",
    "zero nine one seven one two three four",
    "٠٩١٧١٢٣٤٥٦٧",
    "०९१७ १२३ ४५६७",
    "0️⃣9️⃣1️⃣7️⃣1️⃣2️⃣3️⃣",
  ])("detects phone: %s", (text) => {
    expect(containsPhoneNumber(text)).toBe(true);
  });

  it.each(["I'm 24", "at 10:30 pm", "500 pesos", "born 1999", "top 10 of 2024", "room 1203"])(
    "allows numbers: %s",
    (text) => {
      expect(containsPhoneNumber(text)).toBe(false);
    },
  );
});

describe("containsEmail", () => {
  it.each([
    "mika@gmail.com",
    "MIKA.24@Yahoo.co",
    "mika at gmail dot com",
    "mika (at) gmail (dot) com",
    "mika[at]mail[dot]com",
  ])("detects email: %s", (text) => {
    expect(containsEmail(text)).toBe(true);
  });

  it.each(["I'm at home", "look at that", "meet at 5", "I'm at home. ok"])("allows: %s", (text) => {
    expect(containsEmail(text)).toBe(false);
  });
});

describe("containsSocialHandle", () => {
  it.each([
    "add me on ig",
    "my telegram is mika24",
    "whatsapp me",
    "@mika_24",
    "hmu on snap",
    "dm me on insta mika.24",
    "fb: mika santos",
  ])("detects social: %s", (text) => {
    expect(containsSocialHandle(text)).toBe(true);
  });

  it.each([
    "I hate facebook",
    "telegram is slow lately",
    "my email is down",
    "of course",
    "see you @ 5",
  ])("allows: %s", (text) => {
    expect(containsSocialHandle(text)).toBe(false);
  });
});

describe("containsContactDetails", () => {
  it("is true for any phone, email or social handle", () => {
    expect(containsContactDetails("call 09171234567")).toBe(true);
    expect(containsContactDetails("mika@gmail.com")).toBe(true);
    expect(containsContactDetails("add me on ig")).toBe(true);
    expect(containsContactDetails("hello there")).toBe(false);
  });
});

describe("contact bypasses", () => {
  it.each(["0917  123  4567", "0917_123_4567", "0917\t123\n4567"])("detects phone: %s", (text) => {
    expect(containsPhoneNumber(text)).toBe(true);
  });

  it("allows an 8-digit date", () => {
    expect(containsPhoneNumber("11/18/2026")).toBe(false);
  });

  it.each(["mika @ gmail . com", "mika@ gmail.com", "mika @gmail. com"])(
    "detects email: %s",
    (text) => {
      expect(containsEmail(text)).toBe(true);
    },
  );

  it.each(["I'm @ home. ok", "meet @ cafe. so fun"])("allows: %s", (text) => {
    expect(containsEmail(text)).toBe(false);
  });
});
