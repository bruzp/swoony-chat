import { render, screen } from "@testing-library/react";
import { expect, it } from "vitest";
import type { Profile } from "@shared/profile";
import { ShortMeta } from "./ShortMeta";

function profile(gender: Profile["gender"]): Profile {
  return { nickname: "mika", gender, age: 25, country: "PH", bio: "" };
}

it("shows a gender icon before age and country, and names the gender for screen readers", () => {
  const { container } = render(<ShortMeta user={profile("female")} />);
  expect(container).toHaveTextContent("25 · PH");
  expect(container.querySelector("svg")).not.toBeNull();
});

it("uses a different icon for male", () => {
  const female = render(<ShortMeta user={profile("female")} />).container;
  const male = render(<ShortMeta user={profile("male")} />).container;
  expect(male).toHaveTextContent("Male, 25, Philippines");
  expect(male.querySelector("svg")?.outerHTML).not.toBe(female.querySelector("svg")?.outerHTML);
});

it("shows a rainbow icon for Other", () => {
  const { container } = render(<ShortMeta user={profile("other")} />);
  expect(container).toHaveTextContent("Other, 25, Philippines");
  const icon = container.querySelector("svg");
  const gradientId = /^url\(#(.+)\)$/.exec(icon?.getAttribute("stroke") ?? "")?.[1];
  expect(gradientId).toBeDefined();
  const gradient = container.querySelector(`linearGradient[id="${gradientId ?? ""}"]`);
  expect(gradient?.querySelectorAll("stop").length).toBeGreaterThanOrEqual(5);
});

it("the rainbow spans the whole icon so its straight lines still paint", () => {
  const { container } = render(<ShortMeta user={profile("other")} />);
  const gradient = container.querySelector("linearGradient");
  expect(gradient).toHaveAttribute("gradientUnits", "userSpaceOnUse");
  expect(gradient).toHaveAttribute("x2", "24");
});

it("reads gender, age and the full country name to screen readers", () => {
  render(<ShortMeta user={profile("female")} />);
  expect(screen.getByText("Female, 25, Philippines")).toHaveClass("sr-only");
  expect(screen.getByText("25 · PH").closest("[aria-hidden]")).toHaveAttribute(
    "aria-hidden",
    "true",
  );
});
