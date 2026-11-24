import { useCallback, useSyncExternalStore } from "react";

export type ThemeChoice = "system" | "light" | "dark";
export type ResolvedTheme = "light" | "dark";

export const THEME_STORAGE_KEY = "swoony-theme";
const DARK_QUERY = "(prefers-color-scheme: dark)";
const CHOICE_EVENT = "swoony-theme-change";
const ADDRESS_BAR_COLORS: Record<ResolvedTheme, string> = { light: "#FBF9FA", dark: "#14101A" };

function isThemeChoice(value: unknown): value is ThemeChoice {
  return value === "system" || value === "light" || value === "dark";
}

export function getThemeChoice(): ThemeChoice {
  try {
    const stored = localStorage.getItem(THEME_STORAGE_KEY);
    return isThemeChoice(stored) ? stored : "system";
  } catch {
    return "system";
  }
}

export function setThemeChoice(choice: ThemeChoice): void {
  try {
    if (choice === "system") localStorage.removeItem(THEME_STORAGE_KEY);
    else localStorage.setItem(THEME_STORAGE_KEY, choice);
  } catch {
    // Storage blocked: the choice still applies for this page view.
  }
  memoryChoice = choice;
  window.dispatchEvent(new Event(CHOICE_EVENT));
}

export function resolveTheme(choice: ThemeChoice, systemDark: boolean): ResolvedTheme {
  if (choice === "system") return systemDark ? "dark" : "light";
  return choice;
}

export function applyTheme(theme: ResolvedTheme): void {
  const root = document.documentElement;
  root.classList.toggle("dark", theme === "dark");
  root.style.colorScheme = theme;
  for (const meta of document.querySelectorAll<HTMLMetaElement>('meta[name="theme-color"]')) {
    meta.content = ADDRESS_BAR_COLORS[theme];
  }
}

let memoryChoice: ThemeChoice | null = null;

function currentChoice(): ThemeChoice {
  return memoryChoice ?? getThemeChoice();
}

function systemPrefersDark(): boolean {
  return window.matchMedia(DARK_QUERY).matches;
}

function snapshot(): string {
  return `${currentChoice()}:${systemPrefersDark() ? "dark" : "light"}`;
}

function subscribe(onChange: () => void): () => void {
  const media = window.matchMedia(DARK_QUERY);
  const onOtherTab = (event: StorageEvent) => {
    if (event.key !== THEME_STORAGE_KEY && event.key !== null) return;
    memoryChoice = null;
    onChange();
  };
  media.addEventListener("change", onChange);
  window.addEventListener(CHOICE_EVENT, onChange);
  window.addEventListener("storage", onOtherTab);
  return () => {
    media.removeEventListener("change", onChange);
    window.removeEventListener(CHOICE_EVENT, onChange);
    window.removeEventListener("storage", onOtherTab);
  };
}

export function useTheme(): {
  choice: ThemeChoice;
  theme: ResolvedTheme;
  setChoice: (choice: ThemeChoice) => void;
} {
  const [choicePart, systemPart] = useSyncExternalStore(subscribe, snapshot).split(":");
  const choice = isThemeChoice(choicePart) ? choicePart : "system";
  const theme = resolveTheme(choice, systemPart === "dark");
  const setChoice = useCallback((next: ThemeChoice) => {
    setThemeChoice(next);
  }, []);
  return { choice, theme, setChoice };
}
