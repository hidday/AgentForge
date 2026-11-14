import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ConfirmDialog } from "./ConfirmDialog.tsx";

const baseProps = {
  open: true,
  title: "Approve plan?",
  description: "This will start execution.",
  confirmLabel: "Approve",
  onConfirm: vi.fn(),
  onCancel: vi.fn(),
};

describe("ConfirmDialog", () => {
  it("renders nothing when closed", () => {
    const { container } = render(<ConfirmDialog {...baseProps} open={false} />);
    expect(container.firstChild).toBeNull();
  });

  it("renders the title, description, and confirm label when open", () => {
    render(<ConfirmDialog {...baseProps} />);
    expect(screen.getByText("Approve plan?")).toBeDefined();
    expect(screen.getByText("This will start execution.")).toBeDefined();
    expect(screen.getByRole("button", { name: "Approve" })).toBeDefined();
  });

  it("calls onConfirm with undefined when there is no notes field", async () => {
    const onConfirm = vi.fn();
    render(<ConfirmDialog {...baseProps} onConfirm={onConfirm} />);

    await userEvent.click(screen.getByRole("button", { name: "Approve" }));

    expect(onConfirm).toHaveBeenCalledWith(undefined);
  });

  it("calls onConfirm with the trimmed note when a notes field is present and filled", async () => {
    const onConfirm = vi.fn();
    render(
      <ConfirmDialog
        {...baseProps}
        notes={{ label: "Notes", placeholder: "..." }}
        onConfirm={onConfirm}
      />,
    );

    await userEvent.type(screen.getByRole("textbox"), "  please be careful  ");
    await userEvent.click(screen.getByRole("button", { name: "Approve" }));

    expect(onConfirm).toHaveBeenCalledWith("please be careful");
  });

  it("calls onConfirm with undefined when the notes field is left blank", async () => {
    const onConfirm = vi.fn();
    render(<ConfirmDialog {...baseProps} notes={{}} onConfirm={onConfirm} />);

    await userEvent.click(screen.getByRole("button", { name: "Approve" }));

    expect(onConfirm).toHaveBeenCalledWith(undefined);
  });

  it("calls onCancel when the Cancel button is clicked", async () => {
    const onCancel = vi.fn();
    render(<ConfirmDialog {...baseProps} onCancel={onCancel} />);

    await userEvent.click(screen.getByRole("button", { name: "Cancel" }));

    expect(onCancel).toHaveBeenCalledOnce();
  });

  it("calls onCancel when clicking the backdrop", async () => {
    const onCancel = vi.fn();
    const { container } = render(<ConfirmDialog {...baseProps} onCancel={onCancel} />);

    const backdrop = container.querySelector(".absolute.inset-0");
    await userEvent.click(backdrop!);

    expect(onCancel).toHaveBeenCalledOnce();
  });

  it("shows a working indicator and disables buttons while loading", () => {
    render(<ConfirmDialog {...baseProps} loading notes={{}} />);

    expect(screen.getByText("Working...")).toBeDefined();
    expect((screen.getByRole("button", { name: "Cancel" }) as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByRole("textbox") as HTMLTextAreaElement).disabled).toBe(true);
  });

  it("applies the destructive variant's styling", () => {
    render(<ConfirmDialog {...baseProps} variant="destructive" />);
    const confirmBtn = screen.getByRole("button", { name: "Approve" });
    expect(confirmBtn.className).toContain("state-blocked");
  });
});
