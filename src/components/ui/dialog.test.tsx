import { render, screen } from "@testing-library/react";
import { expect, it } from "vitest";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "./dialog";

it("gives the dialog close button a 44px tap target", () => {
  render(
    <Dialog open>
      <DialogContent>
        <DialogTitle>Title</DialogTitle>
        <DialogDescription>Body</DialogDescription>
      </DialogContent>
    </Dialog>,
  );
  expect(screen.getByRole("button", { name: "Close" })).toHaveClass("size-11");
});
