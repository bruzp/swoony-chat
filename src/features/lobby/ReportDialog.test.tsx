import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, it, vi } from "vitest";
import { ReportDialog } from "./ReportDialog";
import { lobbyUser } from "./testing";

const mika = lobbyUser("u1", { nickname: "mika" });

function renderDialog() {
  const onSubmit = vi.fn();
  const onOpenChange = vi.fn();
  render(<ReportDialog user={mika} open onOpenChange={onOpenChange} onSubmit={onSubmit} />);
  return { onSubmit, onOpenChange };
}

it("report dialog sends the chosen reason", async () => {
  const { onSubmit, onOpenChange } = renderDialog();
  const dialog = screen.getByRole("dialog", { name: "Report mika" });
  for (const label of [
    "Spam",
    "Harassment",
    "Seems under 18",
    "Sexual content",
    "Something else",
  ]) {
    expect(within(dialog).getByRole("radio", { name: label })).toBeInTheDocument();
  }
  const user = userEvent.setup();
  expect(within(dialog).getByRole("button", { name: "Report" })).toBeDisabled();
  await user.click(within(dialog).getByRole("radio", { name: "Seems under 18" }));
  await user.click(within(dialog).getByRole("button", { name: "Report" }));
  expect(onSubmit).toHaveBeenCalledWith("underage");
  expect(onOpenChange).toHaveBeenCalledWith(false);
});

it("explains that reporting also blocks", () => {
  renderDialog();
  expect(screen.getByText(/also blocks mika/)).toBeInTheDocument();
});
