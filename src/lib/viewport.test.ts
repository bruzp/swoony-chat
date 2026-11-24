import { afterEach, expect, it } from "vitest";
import { installViewportHeight } from "./viewport";

class FakeVisualViewport extends EventTarget {
  height = 700;
}

const root = document.documentElement;

afterEach(() => {
  Reflect.deleteProperty(window, "visualViewport");
  root.style.removeProperty("--app-height");
});

it("installViewportHeight tracks visualViewport height", () => {
  const viewport = new FakeVisualViewport();
  Object.defineProperty(window, "visualViewport", { value: viewport, configurable: true });
  const uninstall = installViewportHeight();
  expect(root.style.getPropertyValue("--app-height")).toBe("700px");

  viewport.height = 500;
  viewport.dispatchEvent(new Event("resize"));
  expect(root.style.getPropertyValue("--app-height")).toBe("500px");

  viewport.height = 480;
  viewport.dispatchEvent(new Event("scroll"));
  expect(root.style.getPropertyValue("--app-height")).toBe("480px");

  uninstall();
  expect(root.style.getPropertyValue("--app-height")).toBe("");
  viewport.height = 300;
  viewport.dispatchEvent(new Event("resize"));
  expect(root.style.getPropertyValue("--app-height")).toBe("");
});

it("keeps the last height while the page is pinch-zoomed", () => {
  const viewport = Object.assign(new FakeVisualViewport(), { scale: 1 });
  Object.defineProperty(window, "visualViewport", { value: viewport, configurable: true });
  const uninstall = installViewportHeight();
  viewport.scale = 2;
  viewport.height = 350;
  viewport.dispatchEvent(new Event("resize"));
  expect(root.style.getPropertyValue("--app-height")).toBe("700px");
  uninstall();
});

it("leaves --app-height unset without visualViewport so CSS falls back to 100dvh", () => {
  Object.defineProperty(window, "visualViewport", { value: null, configurable: true });
  const uninstall = installViewportHeight();
  expect(root.style.getPropertyValue("--app-height")).toBe("");
  uninstall();
});
