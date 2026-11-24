import { render } from "@testing-library/react";
import { expect, it } from "vitest";
import { LetterTile } from "./LetterTile";

function hueOf(element: Element | null): string | undefined {
  return (element as HTMLElement | null)?.style.getPropertyValue("--tile-hue");
}

it("LetterTile shows the first letter", () => {
  const { container } = render(<LetterTile name="mika" gender="female" />);
  const tile = container.firstElementChild;
  expect(tile).toHaveTextContent("M");
  expect(tile).toHaveAttribute("aria-hidden", "true");
});

it("tiles are coloured by gender, not by name", () => {
  const female = render(<LetterTile name="mika" gender="female" />).container.firstElementChild;
  const otherFemale = render(<LetterTile name="zed" gender="female" />).container.firstElementChild;
  const male = render(<LetterTile name="mika" gender="male" />).container.firstElementChild;
  const other = render(<LetterTile name="mika" gender="other" />).container.firstElementChild;
  expect(hueOf(female)).toBe(hueOf(otherFemale));
  expect(new Set([hueOf(female), hueOf(male), hueOf(other)]).size).toBe(3);
});
