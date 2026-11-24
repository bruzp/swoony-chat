import { describe, expect, it } from "vitest";
import { moderateText } from "./moderateText";
import { normalizeForChecks } from "./normalize";

describe("moderateText", () => {
  it("rejects empty, long, link, contact, profanity", () => {
    expect(moderateText("   ", 1000)).toEqual({ ok: false, reason: "empty" });
    expect(moderateText("😀".repeat(1001), 1000)).toEqual({ ok: false, reason: "too_long" });
    expect(moderateText("😀".repeat(1000), 1000).ok).toBe(true);
    expect(moderateText("see www.x.com", 1000)).toEqual({ ok: false, reason: "link" });
    expect(moderateText("text me 09171234567", 1000)).toEqual({ ok: false, reason: "contact" });
    expect(moderateText("add me on ig mika24", 1000)).toEqual({ ok: false, reason: "contact" });
    expect(moderateText("fuck off", 1000)).toEqual({ ok: false, reason: "profanity" });
    expect(moderateText("  hi  ", 1000)).toEqual({ ok: true, text: "hi" });
  });

  it("treats zero-width-only text as empty", () => {
    expect(moderateText("\u200B\u200D", 1000)).toEqual({ ok: false, reason: "empty" });
  });

  it("reports emails as contact details, not links", () => {
    expect(moderateText("mika@gmail.com", 1000)).toEqual({ ok: false, reason: "contact" });
    expect(moderateText("mika at gmail dot com", 1000)).toEqual({ ok: false, reason: "contact" });
  });
});

describe("normalizeForChecks", () => {
  it("applies NFKC, lower-cases and strips zero-width characters", () => {
    expect(normalizeForChecks("ＨＥ\u200BLLO")).toBe("hello");
  });

  it("maps 0 to o only inside letter runs", () => {
    expect(normalizeForChecks("g00gle 0917 10")).toBe("google 0917 10");
  });
});

describe("moderateText returned text", () => {
  it("strips direction overrides so a reversed link shows as typed", () => {
    expect(moderateText("\u202Emoc.elgoog", 1000)).toEqual({ ok: true, text: "moc.elgoog" });
    expect(moderateText("\u202Emoc.liamg@akim", 1000)).toEqual({
      ok: true,
      text: "moc.liamg@akim",
    });
  });

  it("strips control and format characters but keeps line breaks and emoji joiners", () => {
    expect(moderateText("hi\u0001\u200Bthere\nfamily \u{1F468}\u200D\u{1F469}", 1000)).toEqual({
      ok: true,
      text: "hithere\nfamily \u{1F468}\u200D\u{1F469}",
    });
  });

  it.each(["\u3164\u3164", "\u2800\u2800", "\u115F\u1160", "\uFFA0"])(
    "treats blank filler characters as empty: %s",
    (text) => {
      expect(moderateText(text, 1000)).toEqual({ ok: false, reason: "empty" });
    },
  );
  it("collapses runs of blank lines so a message can't flood the screen", () => {
    expect(moderateText(`hi${"\n".repeat(500)}there`, 1000)).toEqual({
      ok: true,
      text: "hi\n\nthere",
    });
  });

  it("treats whitespace-only lines and CRLF line ends as blank when collapsing", () => {
    expect(moderateText("a\r\n \r\n\t\r\n\r\nb", 1000)).toEqual({ ok: true, text: "a\n\nb" });
  });

  it("treats Unicode line and paragraph separators as line breaks", () => {
    expect(moderateText("a\u2028\u2029\u2028\u2029b", 1000)).toEqual({ ok: true, text: "a\n\nb" });
  });

  it("leaves digits and ordinary text untouched", () => {
    expect(moderateText("born 1989, moved in 2002", 1000)).toEqual({
      ok: true,
      text: "born 1989, moved in 2002",
    });
  });

  it("keeps a single blank line between paragraphs", () => {
    expect(moderateText("one\n\ntwo\nthree", 1000)).toEqual({
      ok: true,
      text: "one\n\ntwo\nthree",
    });
  });
});
