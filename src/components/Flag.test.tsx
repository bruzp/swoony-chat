import { render, waitFor } from "@testing-library/react";
import { expect, it } from "vitest";
import { Flag } from "./Flag";

it("renders a hidden flag image for a known country code", async () => {
  const { container } = render(<Flag code="PH" />);
  await waitFor(() => {
    expect(container.querySelector("img")).not.toBeNull();
  });
  const img = container.querySelector("img");
  expect(img).toHaveAttribute("aria-hidden", "true");
  expect(img).toHaveAttribute("alt", "");
  expect(img?.getAttribute("src")).toBeTruthy();
});

it("shows the flag on the first render so the line does not shift when it loads", () => {
  const { container } = render(<Flag code="JP" />);
  expect(container.querySelector("img")).not.toBeNull();
});

it.each(["T1", "ZZ"])("renders nothing for an unknown code %s", async (code) => {
  const { container } = render(<Flag code={code} />);
  await new Promise((resolve) => setTimeout(resolve, 20));
  expect(container).toBeEmptyDOMElement();
});
