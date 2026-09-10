import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { ConfirmDialog } from "./ConfirmDialog";

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

  it("renders the title, description, and confirm label when open", () => {
    render(
      <ConfirmDialog
        open
        title="Approve plan?"
        description="This will move the run forward."
        confirmLabel="Approve"
        onConfirm={vi.fn()}
        onCancel={vi.fn()}
      />,
    );
    expect(screen.getByText("Approve plan?")).toBeDefined();
    expect(screen.getByText("This will move the run forward.")).toBeDefined();
    expect(screen.getByText("Approve")).toBeDefined();
  });

  it("calls onConfirm with no note when notes are not enabled", () => {
    const onConfirm = vi.fn();
    render(
      <ConfirmDialog
        open
        title="T"
        description="D"
        confirmLabel="Go"
        onConfirm={onConfirm}
        onCancel={vi.fn()}
      />,
    );
    fireEvent.click(screen.getByText("Go"));
    expect(onConfirm).toHaveBeenCalledWith(undefined);
  });

  it("calls onConfirm with the trimmed note when notes are provided", () => {
    const onConfirm = vi.fn();
    render(
      <ConfirmDialog
        open
        title="T"
        description="D"
        confirmLabel="Go"
        notes={{ label: "Notes", placeholder: "type here" }}
        onConfirm={onConfirm}
        onCancel={vi.fn()}
      />,
    );
    const textarea = screen.getByPlaceholderText("type here");
    fireEvent.change(textarea, { target: { value: "  a helpful note  " } });
    fireEvent.click(screen.getByText("Go"));
    expect(onConfirm).toHaveBeenCalledWith("a helpful note");
  });

  it("passes undefined when the note is only whitespace", () => {
    const onConfirm = vi.fn();
    render(
      <ConfirmDialog
        open
        title="T"
        description="D"
        confirmLabel="Go"
        notes={{}}
        onConfirm={onConfirm}
        onCancel={vi.fn()}
      />,
    );
    const textarea = screen.getByPlaceholderText(
      "Optional: anything the next agent should know...",
    );
    fireEvent.change(textarea, { target: { value: "   " } });
    fireEvent.click(screen.getByText("Go"));
    expect(onConfirm).toHaveBeenCalledWith(undefined);
  });

  it("calls onCancel when the cancel button is clicked", () => {
    const onCancel = vi.fn();
    render(
      <ConfirmDialog
        open
        title="T"
        description="D"
        confirmLabel="Go"
        onConfirm={vi.fn()}
        onCancel={onCancel}
      />,
    );
    fireEvent.click(screen.getByText("Cancel"));
    expect(onCancel).toHaveBeenCalled();
  });

  it("calls onCancel when the backdrop is clicked", () => {
    const onCancel = vi.fn();
    const { container } = render(
      <ConfirmDialog
        open
        title="T"
        description="D"
        confirmLabel="Go"
        onConfirm={vi.fn()}
        onCancel={onCancel}
      />,
    );
    fireEvent.click(container.querySelector(".backdrop-blur-sm")!);
    expect(onCancel).toHaveBeenCalled();
  });

  it("shows a working state and disables buttons while loading", () => {
    render(
      <ConfirmDialog
        open
        title="T"
        description="D"
        confirmLabel="Go"
        loading
        onConfirm={vi.fn()}
        onCancel={vi.fn()}
      />,
    );
    expect(screen.getByText("Working...")).toBeDefined();
    expect(screen.getByText("Cancel")).toHaveProperty("disabled", true);
  });

  it("applies destructive styling when variant is destructive", () => {
    render(
      <ConfirmDialog
        open
        title="T"
        description="D"
        confirmLabel="Delete"
        variant="destructive"
        onConfirm={vi.fn()}
        onCancel={vi.fn()}
      />,
    );
    expect(screen.getByText("Delete").className).toContain("state-blocked");
  });
});
