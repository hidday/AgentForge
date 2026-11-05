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

  it("renders the title, description, and confirm label when open", () => {
    render(
      <ConfirmDialog
        open={true}
        title="Delete run?"
        description="This cannot be undone."
        confirmLabel="Delete"
        onConfirm={vi.fn()}
        onCancel={vi.fn()}
      />,
    );
    expect(screen.getByText("Delete run?")).toBeDefined();
    expect(screen.getByText("This cannot be undone.")).toBeDefined();
    expect(screen.getByRole("button", { name: "Delete" })).toBeDefined();
  });

  it("calls onConfirm (with no note) when confirm is clicked and no notes prop is given", async () => {
    const onConfirm = vi.fn();
    render(
      <ConfirmDialog
        open={true}
        title="Title"
        description="Desc"
        confirmLabel="Go"
        onConfirm={onConfirm}
        onCancel={vi.fn()}
      />,
    );
    await userEvent.click(screen.getByRole("button", { name: "Go" }));
    expect(onConfirm).toHaveBeenCalledWith(undefined);
  });

  it("calls onCancel when the Cancel button is clicked", async () => {
    const onCancel = vi.fn();
    render(
      <ConfirmDialog
        open={true}
        title="Title"
        description="Desc"
        confirmLabel="Go"
        onConfirm={vi.fn()}
        onCancel={onCancel}
      />,
    );
    await userEvent.click(screen.getByRole("button", { name: /cancel/i }));
    expect(onCancel).toHaveBeenCalledOnce();
  });

  it("calls onCancel when the backdrop is clicked", async () => {
    const onCancel = vi.fn();
    const { container } = render(
      <ConfirmDialog
        open={true}
        title="Title"
        description="Desc"
        confirmLabel="Go"
        onConfirm={vi.fn()}
        onCancel={onCancel}
      />,
    );
    const backdrop = container.querySelector(".fixed.inset-0 > .absolute.inset-0");
    expect(backdrop).not.toBeNull();
    await userEvent.click(backdrop as Element);
    expect(onCancel).toHaveBeenCalledOnce();
  });

  it("does not render a notes textarea when the notes prop is omitted", () => {
    render(
      <ConfirmDialog
        open={true}
        title="Title"
        description="Desc"
        confirmLabel="Go"
        onConfirm={vi.fn()}
        onCancel={vi.fn()}
      />,
    );
    expect(screen.queryByRole("textbox")).toBeNull();
  });

  it("renders a notes textarea with default label/placeholder when notes prop is {}", () => {
    render(
      <ConfirmDialog
        open={true}
        title="Title"
        description="Desc"
        confirmLabel="Go"
        notes={{}}
        onConfirm={vi.fn()}
        onCancel={vi.fn()}
      />,
    );
    expect(screen.getByText(/notes for the next agent/i)).toBeDefined();
    expect(
      screen.getByPlaceholderText(/anything the next agent should know/i),
    ).toBeDefined();
  });

  it("renders custom notes label and placeholder when provided", () => {
    render(
      <ConfirmDialog
        open={true}
        title="Title"
        description="Desc"
        confirmLabel="Go"
        notes={{ label: "Feedback", placeholder: "Type here" }}
        onConfirm={vi.fn()}
        onCancel={vi.fn()}
      />,
    );
    expect(screen.getByText("Feedback")).toBeDefined();
    expect(screen.getByPlaceholderText("Type here")).toBeDefined();
  });

  it("passes the trimmed note text to onConfirm when notes are entered", async () => {
    const onConfirm = vi.fn();
    render(
      <ConfirmDialog
        open={true}
        title="Title"
        description="Desc"
        confirmLabel="Go"
        notes={{}}
        onConfirm={onConfirm}
        onCancel={vi.fn()}
      />,
    );
    const textarea = screen.getByRole("textbox");
    await userEvent.type(textarea, "  some feedback  ");
    await userEvent.click(screen.getByRole("button", { name: "Go" }));
    expect(onConfirm).toHaveBeenCalledWith("some feedback");
  });

  it("passes undefined to onConfirm when notes prop exists but input is empty/whitespace", async () => {
    const onConfirm = vi.fn();
    render(
      <ConfirmDialog
        open={true}
        title="Title"
        description="Desc"
        confirmLabel="Go"
        notes={{}}
        onConfirm={onConfirm}
        onCancel={vi.fn()}
      />,
    );
    const textarea = screen.getByRole("textbox");
    await userEvent.type(textarea, "   ");
    await userEvent.click(screen.getByRole("button", { name: "Go" }));
    expect(onConfirm).toHaveBeenCalledWith(undefined);
  });

  it("clears the note textarea after confirming", async () => {
    render(
      <ConfirmDialog
        open={true}
        title="Title"
        description="Desc"
        confirmLabel="Go"
        notes={{}}
        onConfirm={vi.fn()}
        onCancel={vi.fn()}
      />,
    );
    const textarea = screen.getByRole("textbox") as HTMLTextAreaElement;
    await userEvent.type(textarea, "note text");
    await userEvent.click(screen.getByRole("button", { name: "Go" }));
    expect(textarea.value).toBe("");
  });

  it("clears the note textarea after cancelling", async () => {
    render(
      <ConfirmDialog
        open={true}
        title="Title"
        description="Desc"
        confirmLabel="Go"
        notes={{}}
        onConfirm={vi.fn()}
        onCancel={vi.fn()}
      />,
    );
    const textarea = screen.getByRole("textbox") as HTMLTextAreaElement;
    await userEvent.type(textarea, "note text");
    await userEvent.click(screen.getByRole("button", { name: /cancel/i }));
    expect(textarea.value).toBe("");
  });

  it("uses default styling for the confirm button when variant is omitted", () => {
    render(
      <ConfirmDialog
        open={true}
        title="Title"
        description="Desc"
        confirmLabel="Go"
        onConfirm={vi.fn()}
        onCancel={vi.fn()}
      />,
    );
    const confirmBtn = screen.getByRole("button", { name: "Go" });
    expect(confirmBtn.className).toContain("bg-accent");
    expect(confirmBtn.className).not.toContain("bg-state-blocked");
  });

  it("uses destructive styling for the confirm button when variant is 'destructive'", () => {
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

  it("shows a 'Working...' loading state and disables both buttons when loading is true", () => {
    render(
      <ConfirmDialog
        open={true}
        title="Title"
        description="Desc"
        confirmLabel="Go"
        loading={true}
        onConfirm={vi.fn()}
        onCancel={vi.fn()}
      />,
    );
    expect(screen.getByText(/working/i)).toBeDefined();
    expect(screen.queryByRole("button", { name: "Go" })).toBeNull();
    const cancelBtn = screen.getByRole("button", { name: /cancel/i }) as HTMLButtonElement;
    expect(cancelBtn.disabled).toBe(true);
  });

  it("disables the notes textarea while loading", () => {
    render(
      <ConfirmDialog
        open={true}
        title="Title"
        description="Desc"
        confirmLabel="Go"
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
