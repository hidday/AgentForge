import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ConfirmDialog } from "./ConfirmDialog.tsx";

describe("ConfirmDialog", () => {
  const onConfirm = vi.fn();
  const onCancel = vi.fn();

  beforeEach(() => {
    onConfirm.mockClear();
    onCancel.mockClear();
  });

  it("renders nothing when open is false", () => {
    const { container } = render(
      <ConfirmDialog
        open={false}
        title="Title"
        description="Desc"
        confirmLabel="Go"
        onConfirm={onConfirm}
        onCancel={onCancel}
      />,
    );
    expect(container.firstChild).toBeNull();
  });

  it("renders the title, description and confirm label when open", () => {
    render(
      <ConfirmDialog
        open
        title="Approve Plan"
        description="This will start implementation."
        confirmLabel="Approve & Start"
        onConfirm={onConfirm}
        onCancel={onCancel}
      />,
    );
    expect(screen.getByText("Approve Plan")).toBeDefined();
    expect(screen.getByText("This will start implementation.")).toBeDefined();
    expect(screen.getByRole("button", { name: "Approve & Start" })).toBeDefined();
  });

  it("calls onConfirm with undefined when no notes prop is given", async () => {
    render(
      <ConfirmDialog
        open
        title="T"
        description="D"
        confirmLabel="Confirm"
        onConfirm={onConfirm}
        onCancel={onCancel}
      />,
    );
    await userEvent.click(screen.getByRole("button", { name: "Confirm" }));
    expect(onConfirm).toHaveBeenCalledWith(undefined);
  });

  it("does not render a notes textarea when notes prop is omitted", () => {
    render(
      <ConfirmDialog
        open
        title="T"
        description="D"
        confirmLabel="Confirm"
        onConfirm={onConfirm}
        onCancel={onCancel}
      />,
    );
    expect(screen.queryByRole("textbox")).toBeNull();
  });

  it("calls onConfirm with the trimmed note text when notes are provided and filled in", async () => {
    render(
      <ConfirmDialog
        open
        title="T"
        description="D"
        confirmLabel="Confirm"
        notes={{ label: "Notes", placeholder: "..." }}
        onConfirm={onConfirm}
        onCancel={onCancel}
      />,
    );
    const textarea = screen.getByPlaceholderText("...");
    await userEvent.type(textarea, "  some note  ");
    await userEvent.click(screen.getByRole("button", { name: "Confirm" }));
    expect(onConfirm).toHaveBeenCalledWith("some note");
  });

  it("calls onConfirm with undefined when notes are provided but left blank/whitespace", async () => {
    render(
      <ConfirmDialog
        open
        title="T"
        description="D"
        confirmLabel="Confirm"
        notes={{}}
        onConfirm={onConfirm}
        onCancel={onCancel}
      />,
    );
    const textarea = screen.getByRole("textbox");
    await userEvent.type(textarea, "   ");
    await userEvent.click(screen.getByRole("button", { name: "Confirm" }));
    expect(onConfirm).toHaveBeenCalledWith(undefined);
  });

  it("uses default notes label/placeholder when notes object has no label/placeholder", () => {
    render(
      <ConfirmDialog
        open
        title="T"
        description="D"
        confirmLabel="Confirm"
        notes={{}}
        onConfirm={onConfirm}
        onCancel={onCancel}
      />,
    );
    expect(screen.getByText("Notes for the next agent (optional)")).toBeDefined();
    expect(
      screen.getByPlaceholderText("Optional: anything the next agent should know..."),
    ).toBeDefined();
  });

  it("calls onCancel when the Cancel button is clicked", async () => {
    render(
      <ConfirmDialog
        open
        title="T"
        description="D"
        confirmLabel="Confirm"
        onConfirm={onConfirm}
        onCancel={onCancel}
      />,
    );
    await userEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(onCancel).toHaveBeenCalledTimes(1);
  });

  it("calls onCancel when the backdrop is clicked", async () => {
    const { container } = render(
      <ConfirmDialog
        open
        title="T"
        description="D"
        confirmLabel="Confirm"
        onConfirm={onConfirm}
        onCancel={onCancel}
      />,
    );
    const backdrop = container.querySelector(".absolute.inset-0");
    expect(backdrop).not.toBeNull();
    await userEvent.click(backdrop as Element);
    expect(onCancel).toHaveBeenCalledTimes(1);
  });

  it("shows the default-variant confirm button styling when variant is omitted", () => {
    render(
      <ConfirmDialog
        open
        title="T"
        description="D"
        confirmLabel="Confirm"
        onConfirm={onConfirm}
        onCancel={onCancel}
      />,
    );
    expect(screen.getByRole("button", { name: "Confirm" }).className).toContain("bg-accent");
  });

  it("shows destructive styling and 'Working...' text while loading", () => {
    render(
      <ConfirmDialog
        open
        title="T"
        description="D"
        confirmLabel="Delete"
        variant="destructive"
        loading
        onConfirm={onConfirm}
        onCancel={onCancel}
      />,
    );
    expect(screen.getByText("Working...")).toBeDefined();
    const confirmBtn = screen.getByText("Working...").closest("button");
    expect(confirmBtn?.className).toContain("bg-state-blocked");
    expect((confirmBtn as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByRole("button", { name: "Cancel" }) as HTMLButtonElement).disabled).toBe(
      true,
    );
  });

  it("disables the notes textarea while loading", () => {
    render(
      <ConfirmDialog
        open
        title="T"
        description="D"
        confirmLabel="Confirm"
        notes={{}}
        loading
        onConfirm={onConfirm}
        onCancel={onCancel}
      />,
    );
    expect((screen.getByRole("textbox") as HTMLTextAreaElement).disabled).toBe(true);
  });
});
