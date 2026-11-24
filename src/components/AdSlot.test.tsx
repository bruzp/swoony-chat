import { render } from "@testing-library/react";
import { expect, it } from "vitest";
import { AdSlot, AdSlotBox } from "./AdSlot";

it("AdSlot renders nothing while ads are disabled", () => {
  const { container } = render(<AdSlot placement="list-inline" />);
  expect(container).toBeEmptyDOMElement();
});

it("an enabled slot reserves a fixed box tagged with its placement", () => {
  const { container } = render(<AdSlotBox placement="list-inline" />);
  const box = container.querySelector("[data-ad-placement='list-inline']");
  expect(box).toHaveStyle({ width: "320px", height: "50px" });
});

it("the empty chat area slot is a 300 x 250 box", () => {
  const { container } = render(<AdSlotBox placement="chat-empty" />);
  const box = container.querySelector("[data-ad-placement='chat-empty']");
  expect(box).toHaveStyle({ width: "300px", height: "250px" });
});
