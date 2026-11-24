import { useCallback, useSyncExternalStore } from "react";

const APP_HEIGHT_VAR = "--app-height";
export const DESKTOP_QUERY = "(min-width: 1024px)";
export const WIDE_QUERY = "(min-width: 1280px)";
export const TOUCH_QUERY = "(pointer: coarse)";

export function isTouchScreen(): boolean {
  return window.matchMedia(TOUCH_QUERY).matches;
}

export function keepKeyboardClosedOnTouch(event: Event): void {
  if (isTouchScreen()) event.preventDefault();
}

export function useMediaQuery(query: string): boolean {
  const subscribe = useCallback(
    (onChange: () => void) => {
      const media = window.matchMedia(query);
      media.addEventListener("change", onChange);
      return () => {
        media.removeEventListener("change", onChange);
      };
    },
    [query],
  );
  return useSyncExternalStore(subscribe, () => window.matchMedia(query).matches);
}

export function installViewportHeight(): () => void {
  const viewport = window.visualViewport;
  const root = document.documentElement;
  if (!viewport) return () => undefined;

  const update = () => {
    if (viewport.scale > 1) return;
    root.style.setProperty(APP_HEIGHT_VAR, `${String(viewport.height)}px`);
  };
  update();
  viewport.addEventListener("resize", update);
  viewport.addEventListener("scroll", update);
  return () => {
    viewport.removeEventListener("resize", update);
    viewport.removeEventListener("scroll", update);
    root.style.removeProperty(APP_HEIGHT_VAR);
  };
}
