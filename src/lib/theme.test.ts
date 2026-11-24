import { afterEach, describe, expect, it, vi } from "vitest";
import {
  applyTheme,
  getThemeChoice,
  resolveTheme,
  setThemeChoice,
  THEME_STORAGE_KEY,
} from "./theme";

afterEach(() => {
  vi.restoreAllMocks();
  localStorage.clear();
  document.documentElement.classList.remove("dark");
});

describe("theme", () => {
  it("resolveTheme follows system unless overridden", () => {
    expect(resolveTheme("system", true)).toBe("dark");
    expect(resolveTheme("system", false)).toBe("light");
    expect(resolveTheme("light", true)).toBe("light");
    expect(resolveTheme("dark", false)).toBe("dark");
  });

  it("getThemeChoice falls back to system when storage throws", () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("blocked");
    });
    expect(getThemeChoice()).toBe("system");
  });

  it("getThemeChoice ignores unknown stored values", () => {
    localStorage.setItem(THEME_STORAGE_KEY, "purple");
    expect(getThemeChoice()).toBe("system");
  });

  it("setThemeChoice remembers an override and forgets it for system", () => {
    setThemeChoice("dark");
    expect(getThemeChoice()).toBe("dark");
    setThemeChoice("system");
    expect(localStorage.getItem(THEME_STORAGE_KEY)).toBeNull();
  });

  it("setThemeChoice survives storage that throws", () => {
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("blocked");
    });
    expect(() => {
      setThemeChoice("dark");
    }).not.toThrow();
  });

  it("applyTheme paints the browser's address bar in the chosen theme", () => {
    for (const media of ["(prefers-color-scheme: light)", "(prefers-color-scheme: dark)"]) {
      const meta = document.createElement("meta");
      meta.name = "theme-color";
      meta.media = media;
      document.head.append(meta);
    }
    applyTheme("dark");
    const colors = () =>
      [...document.querySelectorAll<HTMLMetaElement>('meta[name="theme-color"]')].map(
        (meta) => meta.content,
      );
    expect(colors()).toEqual(["#14101A", "#14101A"]);
    applyTheme("light");
    expect(colors()).toEqual(["#FBF9FA", "#FBF9FA"]);
    for (const meta of document.querySelectorAll('meta[name="theme-color"]')) meta.remove();
  });

  it("applyTheme toggles the dark class on <html>", () => {
    applyTheme("dark");
    expect(document.documentElement.classList.contains("dark")).toBe(true);
    applyTheme("light");
    expect(document.documentElement.classList.contains("dark")).toBe(false);
  });
});
