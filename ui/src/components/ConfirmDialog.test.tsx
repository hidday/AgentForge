import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ConfirmDialog } from "./ConfirmDialog.tsx";

describe("ConfirmDialog", () => {
  it("renders nothing when closed", () => {
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

  it("renders title, description, and buttons when open", () => {
    render(
      <ConfirmDialog
        open={true}
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
    expect(screen.getByRole("button", { name: "Cancel" })).toBeDefined();
  });

  it("calls onConfirm with undefined when there is no notes prop", async () => {
    const onConfirm = vi.fn();
    render(
      <ConfirmDialog
        open={true}
        title="Title"
        description="Desc"
        confirmLabel="Confirm"
        onConfirm={onConfirm}
        onCancel={vi.fn()}
      />,
    );
    await userEvent.click(screen.getByRole("button", { name: "Confirm" }));
    expect(onConfirm).toHaveBeenCalledWith(undefined);
  });

  it("renders the notes textarea using provided label/placeholder and forwards trimmed text on confirm", async () => {
    const onConfirm = vi.fn();
    render(
      <ConfirmDialog
        open={true}
        title="Title"
        description="Desc"
        confirmLabel="Confirm"
        notes={{ label: "Notes label", placeholder: "Type here..." }}
        onConfirm={onConfirm}
        onCancel={vi.fn()}
      />,
    );
    expect(screen.getByText("Notes label")).toBeDefined();
    const textarea = screen.getByPlaceholderText("Type here...");
    await userEvent.type(textarea, "  some note  ");
    await userEvent.click(screen.getByRole("button", { name: "Confirm" }));
    expect(onConfirm).toHaveBeenCalledWith("some note");
  });

  it("calls onConfirm with undefined when notes prop is present but the textarea is empty", async () => {
    const onConfirm = vi.fn();
    render(
      <ConfirmDialog
        open={true}
        title="Title"
        description="Desc"
        confirmLabel="Confirm"
        notes={{}}
        onConfirm={onConfirm}
        onCancel={vi.fn()}
      />,
    );
    await userEvent.click(screen.getByRole("button", { name: "Confirm" }));
    expect(onConfirm).toHaveBeenCalledWith(undefined);
  });

  it("uses default notes label/placeholder when notes object provides none", () => {
    render(
      <ConfirmDialog
        open={true}
        title="Title"
        description="Desc"
        confirmLabel="Confirm"
        notes={{}}
        onConfirm={vi.fn()}
        onCancel={vi.fn()}
      />,
    );
    expect(screen.getByText("Notes for the next agent (optional)")).toBeDefined();
    expect(
      screen.getByPlaceholderText("Optional: anything the next agent should know..."),
    ).toBeDefined();
  });

  it("calls onCancel when the Cancel button is clicked", async () => {
    const onCancel = vi.fn();
    render(
      <ConfirmDialog
        open={true}
        title="Title"
        description="Desc"
        confirmLabel="Confirm"
        onConfirm={vi.fn()}
        onCancel={onCancel}
      />,
    );
    await userEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(onCancel).toHaveBeenCalledTimes(1);
  });

  it("calls onCancel when the backdrop is clicked", async () => {
    const onCancel = vi.fn();
    const { container } = render(
      <ConfirmDialog
        open={true}
        title="Title"
        description="Desc"
        confirmLabel="Confirm"
        onConfirm={vi.fn()}
        onCancel={onCancel}
      />,
    );
    const backdrop = container.querySelector(".absolute.inset-0");
    expect(backdrop).not.toBeNull();
    await userEvent.click(backdrop as Element);
    expect(onCancel).toHaveBeenCalledTimes(1);
  });

  it("applies destructive variant styling to the confirm button", () => {
    render(
      <ConfirmDialog
        open={true}
        title="Title"
        description="Desc"
        confirmLabel="Delete"
        variant="destructive"
        onConfirm={vi.fn()}
        onCancel={vi.fn()}
      />,
    );
    const confirmBtn = screen.getByRole("button", { name: "Delete" });
    expect(confirmBtn.className).toContain("bg-state-blocked");
  });

  it("applies default variant styling to the confirm button when variant is omitted", () => {
    render(
      <ConfirmDialog
        open={true}
        title="Title"
        description="Desc"
        confirmLabel="Confirm"
        onConfirm={vi.fn()}
        onCancel={vi.fn()}
      />,
    );
    const confirmBtn = screen.getByRole("button", { name: "Confirm" });
    expect(confirmBtn.className).toContain("bg-accent");
  });

  it("shows a loading spinner and 'Working...' text, and disables both buttons, when loading", () => {
    render(
      <ConfirmDialog
        open={true}
        title="Title"
        description="Desc"
        confirmLabel="Confirm"
        loading={true}
        onConfirm={vi.fn()}
        onCancel={vi.fn()}
      />,
    );
    expect(screen.getByText("Working...")).toBeDefined();
    expect((screen.getByRole("button", { name: "Cancel" }) as HTMLButtonElement).disabled).toBe(
      true,
    );
    expect((screen.getByRole("button", { name: /Working/ }) as HTMLButtonElement).disabled).toBe(
      true,
    );
  });

  it("disables the notes textarea while loading", () => {
    render(
      <ConfirmDialog
        open={true}
        title="Title"
        description="Desc"
        confirmLabel="Confirm"
        notes={{}}
        loading={true}
        onConfirm={vi.fn()}
        onCancel={vi.fn()}
      />,
    );
    expect(
      (
        screen.getByPlaceholderText(
          "Optional: anything the next agent should know...",
        ) as HTMLTextAreaElement
      ).disabled,
    ).toBe(true);
  });
});
