import { render } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { setThemeChoice } from "@/lib/theme";
import { TurnstileField } from "./TurnstileField";

const seen = vi.hoisted(() => ({ options: [] as Record<string, unknown>[] }));

vi.mock("@marsidev/react-turnstile", () => ({
  Turnstile: ({ options }: { options: Record<string, unknown> }) => {
    seen.options.push(options);
    return null;
  },
}));

afterEach(() => {
  seen.options.length = 0;
  setThemeChoice("system");
});

it("shows the bot check in the theme the visitor picked, not only the device setting", () => {
  setThemeChoice("dark");
  const noop = () => undefined;
  render(<TurnstileField onToken={noop} onExpire={noop} onError={noop} resetKey={0} />);
  expect(seen.options.at(-1)).toMatchObject({ theme: "dark" });
});
