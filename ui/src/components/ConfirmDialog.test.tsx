import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ConfirmDialog } from "./ConfirmDialog.tsx";

describe("ConfirmDialog", () => {
  it("renders nothing when open is false", () => {
    const { container } = render(
      <ConfirmDialog
        open={false}
        title="Title"
        description="Description"
        confirmLabel="Confirm"
        onConfirm={vi.fn()}
        onCancel={vi.fn()}
      />,
    );
    expect(container.firstChild).toBeNull();
  });

  it("renders title, description, and confirm label when open", () => {
    render(
      <ConfirmDialog
        open
        title="Approve Plan"
        description="This will approve the plan."
        confirmLabel="Approve & Start"
        onConfirm={vi.fn()}
        onCancel={vi.fn()}
      />,
    );
    expect(screen.getByText("Approve Plan")).toBeDefined();
    expect(screen.getByText("This will approve the plan.")).toBeDefined();
    expect(screen.getByRole("button", { name: "Approve & Start" })).toBeDefined();
  });

  it("does not render a notes textarea when notes prop is omitted", () => {
    render(
      <ConfirmDialog
        open
        title="T"
        description="D"
        confirmLabel="C"
        onConfirm={vi.fn()}
        onCancel={vi.fn()}
      />,
    );
    expect(screen.queryByRole("textbox")).toBeNull();
  });

  it("falls back to the default notes label when notes.label is omitted", () => {
    render(
      <ConfirmDialog
        open
        title="T"
        description="D"
        confirmLabel="Confirm"
        notes={{}}
        onConfirm={vi.fn()}
        onCancel={vi.fn()}
      />,
    );
    expect(screen.getByText("Notes for the next agent (optional)")).toBeDefined();
  });

  it("calls onConfirm with undefined when notes are present but left empty", async () => {
    const onConfirm = vi.fn();
    render(
      <ConfirmDialog
        open
        title="T"
        description="D"
        confirmLabel="Confirm"
        notes={{ label: "Notes", placeholder: "optional" }}
        onConfirm={onConfirm}
        onCancel={vi.fn()}
      />,
    );

    await userEvent.click(screen.getByRole("button", { name: "Confirm" }));
    expect(onConfirm).toHaveBeenCalledWith(undefined);
  });

  it("calls onConfirm with the trimmed note text when notes are entered", async () => {
    const onConfirm = vi.fn();
    render(
      <ConfirmDialog
        open
        title="T"
        description="D"
        confirmLabel="Confirm"
        notes={{ label: "Notes for agent" }}
        onConfirm={onConfirm}
        onCancel={vi.fn()}
      />,
    );

    await userEvent.type(screen.getByRole("textbox"), "  extra context  ");
    await userEvent.click(screen.getByRole("button", { name: "Confirm" }));
    expect(onConfirm).toHaveBeenCalledWith("extra context");
  });

  it("calls onCancel when the Cancel button is clicked", async () => {
    const onCancel = vi.fn();
    render(
      <ConfirmDialog
        open
        title="T"
        description="D"
        confirmLabel="Confirm"
        onConfirm={vi.fn()}
        onCancel={onCancel}
      />,
    );
    await userEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(onCancel).toHaveBeenCalledOnce();
  });

  it("calls onCancel when the backdrop is clicked", async () => {
    const onCancel = vi.fn();
    const { container } = render(
      <ConfirmDialog
        open
        title="T"
        description="D"
        confirmLabel="Confirm"
        onConfirm={vi.fn()}
        onCancel={onCancel}
      />,
    );
    const backdrop = container.querySelector(".absolute.inset-0");
    expect(backdrop).not.toBeNull();
    await userEvent.click(backdrop!);
    expect(onCancel).toHaveBeenCalledOnce();
  });

  it("shows a 'Working...' loading state and disables both buttons when loading", () => {
    render(
      <ConfirmDialog
        open
        title="T"
        description="D"
        confirmLabel="Confirm"
        loading
        onConfirm={vi.fn()}
        onCancel={vi.fn()}
      />,
    );
    expect(screen.getByText("Working...")).toBeDefined();
    expect((screen.getByRole("button", { name: "Cancel" }) as HTMLButtonElement).disabled).toBe(
      true,
    );
    expect(
      (screen.getByRole("button", { name: /Working/ }) as HTMLButtonElement).disabled,
    ).toBe(true);
  });

  it("applies destructive styling when variant is 'destructive'", () => {
    render(
      <ConfirmDialog
        open
        title="T"
        description="D"
        confirmLabel="Reject"
        variant="destructive"
        onConfirm={vi.fn()}
        onCancel={vi.fn()}
      />,
    );
    const confirmBtn = screen.getByRole("button", { name: "Reject" });
    expect(confirmBtn.className).toContain("bg-state-blocked");
  });
});
