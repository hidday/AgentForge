import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ConfirmDialog } from "./ConfirmDialog.tsx";

function setup(props: Partial<React.ComponentProps<typeof ConfirmDialog>> = {}) {
  const onConfirm = vi.fn();
  const onCancel = vi.fn();
  const utils = render(
    <ConfirmDialog
      open
      title="Approve plan?"
      description="This starts implementation."
      confirmLabel="Approve"
      onConfirm={onConfirm}
      onCancel={onCancel}
      {...props}
    />,
  );
  return { ...utils, onConfirm, onCancel };
}

describe("ConfirmDialog", () => {
  it("renders nothing when closed", () => {
    const { container } = setup({ open: false });
    expect(container.innerHTML).toBe("");
  });

  it("shows title and description and confirms without a note when notes are not enabled", async () => {
    const { onConfirm } = setup();
    expect(screen.getByText("Approve plan?")).toBeTruthy();
    expect(screen.getByText("This starts implementation.")).toBeTruthy();
    expect(screen.queryByRole("textbox")).toBeNull();
    await userEvent.click(screen.getByRole("button", { name: "Approve" }));
    expect(onConfirm).toHaveBeenCalledWith(undefined);
  });

  it("uses default notes label/placeholder and passes trimmed note", async () => {
    const { onConfirm } = setup({ notes: {} });
    expect(screen.getByText("Notes for the next agent (optional)")).toBeTruthy();
    const box = screen.getByPlaceholderText("Optional: anything the next agent should know...");
    await userEvent.type(box, "  be careful  ");
    await userEvent.click(screen.getByRole("button", { name: "Approve" }));
    expect(onConfirm).toHaveBeenCalledWith("be careful");
    expect((box as HTMLTextAreaElement).value).toBe("");
  });

  it("passes undefined for whitespace-only notes and honors custom label/placeholder", async () => {
    const { onConfirm } = setup({ notes: { label: "Why?", placeholder: "Reason" } });
    expect(screen.getByText("Why?")).toBeTruthy();
    await userEvent.type(screen.getByPlaceholderText("Reason"), "   ");
    await userEvent.click(screen.getByRole("button", { name: "Approve" }));
    expect(onConfirm).toHaveBeenCalledWith(undefined);
  });

  it("cancels via button and clears the note", async () => {
    const { onCancel, onConfirm } = setup({ notes: {} });
    const box = screen.getByRole("textbox") as HTMLTextAreaElement;
    await userEvent.type(box, "draft");
    await userEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(onCancel).toHaveBeenCalledTimes(1);
    expect(onConfirm).not.toHaveBeenCalled();
    expect(box.value).toBe("");
  });

  it("cancels when the backdrop is clicked", () => {
    const { onCancel, container } = setup();
    fireEvent.click(container.querySelector(".backdrop-blur-sm")!);
    expect(onCancel).toHaveBeenCalledTimes(1);
  });

  it("disables controls and shows a working label while loading", () => {
    setup({ loading: true, notes: {} });
    expect(screen.getByText("Working...")).toBeTruthy();
    expect(screen.queryByText("Approve")).toBeNull();
    expect((screen.getByRole("button", { name: "Cancel" }) as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByRole("textbox") as HTMLTextAreaElement).disabled).toBe(true);
  });

  it("applies destructive styling for the destructive variant", () => {
    setup({ variant: "destructive", confirmLabel: "Reject" });
    expect(screen.getByRole("button", { name: "Reject" }).className).toContain("bg-state-blocked");
  });

  it("applies accent styling by default", () => {
    setup();
    expect(screen.getByRole("button", { name: "Approve" }).className).toContain("bg-accent");
  });
});
