import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ConfirmDialog } from "./ConfirmDialog.tsx";

describe("ConfirmDialog", () => {
  it("renders nothing when closed", () => {
    const { container } = render(
      <ConfirmDialog
        open={false}
        title="Approve Plan"
        description="This will approve the plan."
        confirmLabel="Approve"
        onConfirm={vi.fn()}
        onCancel={vi.fn()}
      />,
    );

    expect(container.firstChild).toBeNull();
  });

  it("renders title, description, and confirm label when open", () => {
    render(
      <ConfirmDialog
        open={true}
        title="Approve Plan"
        description="This will approve the plan and start implementation."
        confirmLabel="Approve & Start"
        onConfirm={vi.fn()}
        onCancel={vi.fn()}
      />,
    );

    expect(screen.getByText("Approve Plan")).toBeDefined();
    expect(
      screen.getByText("This will approve the plan and start implementation."),
    ).toBeDefined();
    expect(screen.getByRole("button", { name: "Approve & Start" })).toBeDefined();
  });

  it("does not render a notes textarea when notes prop is omitted", () => {
    render(
      <ConfirmDialog
        open={true}
        title="Pause Run"
        description="Pause it."
        confirmLabel="Pause"
        onConfirm={vi.fn()}
        onCancel={vi.fn()}
      />,
    );

    expect(screen.queryByRole("textbox")).toBeNull();
  });

  it("calls onConfirm with undefined when notes are provided but left empty", async () => {
    const onConfirm = vi.fn();
    render(
      <ConfirmDialog
        open={true}
        title="Approve Plan"
        description="desc"
        confirmLabel="Approve"
        notes={{ label: "Notes", placeholder: "optional" }}
        onConfirm={onConfirm}
        onCancel={vi.fn()}
      />,
    );

    await userEvent.click(screen.getByRole("button", { name: "Approve" }));

    expect(onConfirm).toHaveBeenCalledWith(undefined);
  });

  it("calls onConfirm with the trimmed note when notes textarea is filled", async () => {
    const onConfirm = vi.fn();
    render(
      <ConfirmDialog
        open={true}
        title="Approve Plan"
        description="desc"
        confirmLabel="Approve"
        notes={{ label: "Notes for executor", placeholder: "optional" }}
        onConfirm={onConfirm}
        onCancel={vi.fn()}
      />,
    );

    expect(screen.getByText("Notes for executor")).toBeDefined();
    const textarea = screen.getByRole("textbox");
    await userEvent.type(textarea, "  watch out for edge cases  ");

    await userEvent.click(screen.getByRole("button", { name: "Approve" }));

    expect(onConfirm).toHaveBeenCalledWith("watch out for edge cases");
  });

  it("calls onCancel when the Cancel button is clicked", async () => {
    const onCancel = vi.fn();
    render(
      <ConfirmDialog
        open={true}
        title="Reject"
        description="desc"
        confirmLabel="Confirm"
        onConfirm={vi.fn()}
        onCancel={onCancel}
      />,
    );

    await userEvent.click(screen.getByRole("button", { name: "Cancel" }));

    expect(onCancel).toHaveBeenCalledOnce();
  });

  it("calls onCancel when the backdrop overlay is clicked", async () => {
    const onCancel = vi.fn();
    const { container } = render(
      <ConfirmDialog
        open={true}
        title="Reject"
        description="desc"
        confirmLabel="Confirm"
        onConfirm={vi.fn()}
        onCancel={onCancel}
      />,
    );

    const backdrop = container.querySelector(".absolute.inset-0");
    expect(backdrop).not.toBeNull();
    await userEvent.click(backdrop as Element);

    expect(onCancel).toHaveBeenCalledOnce();
  });

  it("shows a loading state, disables buttons, and hides the confirm label", () => {
    render(
      <ConfirmDialog
        open={true}
        title="Approve Plan"
        description="desc"
        confirmLabel="Approve & Start"
        loading={true}
        onConfirm={vi.fn()}
        onCancel={vi.fn()}
      />,
    );

    expect(screen.getByText("Working...")).toBeDefined();
    expect(screen.queryByText("Approve & Start")).toBeNull();
    const cancelBtn = screen.getByRole("button", { name: "Cancel" }) as HTMLButtonElement;
    // The confirm button while loading only exposes the "Working..." text node,
    // so grab it by traversing up from that text.
    const workingText = screen.getByText("Working...");
    const confirmBtn = workingText.closest("button") as HTMLButtonElement;
    expect(cancelBtn.disabled).toBe(true);
    expect(confirmBtn.disabled).toBe(true);
  });

  it("applies the destructive style class when variant is destructive", () => {
    render(
      <ConfirmDialog
        open={true}
        title="Reject Plan"
        description="desc"
        confirmLabel="Reject"
        variant="destructive"
        onConfirm={vi.fn()}
        onCancel={vi.fn()}
      />,
    );

    const confirmBtn = screen.getByRole("button", { name: "Reject" });
    expect(confirmBtn.className).toContain("bg-state-blocked");
  });

  it("disables the notes textarea while loading", () => {
    render(
      <ConfirmDialog
        open={true}
        title="Approve Plan"
        description="desc"
        confirmLabel="Approve"
        notes={{}}
        loading={true}
        onConfirm={vi.fn()}
        onCancel={vi.fn()}
      />,
    );

    const textarea = screen.getByRole("textbox") as HTMLTextAreaElement;
    expect(textarea.disabled).toBe(true);
  });
});
