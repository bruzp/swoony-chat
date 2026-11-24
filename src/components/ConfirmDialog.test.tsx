import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, it, vi } from "vitest";
import { ConfirmDialog } from "./ConfirmDialog";

function renderConfirm() {
  const onOpenChange = vi.fn();
  const onConfirm = vi.fn();
  render(
    <ConfirmDialog
      open
      title="Block mika?"
      description="You won't see each other again."
      confirmLabel="Block"
      onConfirm={onConfirm}
      onOpenChange={onOpenChange}
    />,
  );
  return { onOpenChange, onConfirm };
}

it("starts on Cancel so a stray Enter cannot confirm a destructive action", () => {
  renderConfirm();
  expect(screen.getByRole("button", { name: "Cancel" })).toHaveFocus();
});

it("does not close when tapping outside, so the choice is always deliberate", async () => {
  const { onOpenChange } = renderConfirm();
  await userEvent.setup({ pointerEventsCheck: 0 }).click(document.body);
  expect(onOpenChange).not.toHaveBeenCalled();
});

it("confirms and closes", async () => {
  const { onOpenChange, onConfirm } = renderConfirm();
  await userEvent.click(screen.getByRole("button", { name: "Block" }));
  expect(onConfirm).toHaveBeenCalled();
  expect(onOpenChange).toHaveBeenCalledWith(false);
});
