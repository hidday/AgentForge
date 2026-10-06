import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ConfirmDialog } from "./ConfirmDialog.tsx";

describe("ConfirmDialog", () => {
  it("renders nothing when open is false", () => {
    const { container } = render(
      <ConfirmDialog
        open={false}
        title="Delete run"
        description="Are you sure?"
        confirmLabel="Delete"
        onConfirm={vi.fn()}
        onCancel={vi.fn()}
      />,
    );
    expect(container.firstChild).toBeNull();
  });

  it("renders title, description and confirm label when open", () => {
    render(
      <ConfirmDialog
        open={true}
        title="Delete run"
        description="Are you sure?"
        confirmLabel="Delete"
        onConfirm={vi.fn()}
        onCancel={vi.fn()}
      />,
    );
    expect(screen.getByText("Delete run")).toBeDefined();
    expect(screen.getByText("Are you sure?")).toBeDefined();
    expect(screen.getByRole("button", { name: "Delete" })).toBeDefined();
  });

  it("calls onConfirm with undefined when there is no notes prop", async () => {
    const onConfirm = vi.fn();
    render(
      <ConfirmDialog
        open={true}
        title="Delete run"
        description="Are you sure?"
        confirmLabel="Delete"
        onConfirm={onConfirm}
        onCancel={vi.fn()}
      />,
    );
    await userEvent.click(screen.getByRole("button", { name: "Delete" }));
    expect(onConfirm).toHaveBeenCalledWith(undefined);
  });

  it("calls onCancel when the Cancel button is clicked", async () => {
    const onCancel = vi.fn();
    render(
      <ConfirmDialog
        open={true}
        title="Delete run"
        description="Are you sure?"
        confirmLabel="Delete"
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
        open={true}
        title="Delete run"
        description="Are you sure?"
        confirmLabel="Delete"
        onConfirm={vi.fn()}
        onCancel={onCancel}
      />,
    );
    const backdrop = container.querySelector(".absolute.inset-0");
    expect(backdrop).not.toBeNull();
    await userEvent.click(backdrop as Element);
    expect(onCancel).toHaveBeenCalledOnce();
  });

  it("does not render a notes textarea when notes prop is absent", () => {
    render(
      <ConfirmDialog
        open={true}
        title="Delete run"
        description="Are you sure?"
        confirmLabel="Delete"
        onConfirm={vi.fn()}
        onCancel={vi.fn()}
      />,
    );
    expect(screen.queryByRole("textbox")).toBeNull();
  });

  it("renders notes textarea with default label/placeholder and forwards trimmed note on confirm", async () => {
    const onConfirm = vi.fn();
    render(
      <ConfirmDialog
        open={true}
        title="Block run"
        description="Provide context"
        confirmLabel="Block"
        notes={{}}
        onConfirm={onConfirm}
        onCancel={vi.fn()}
      />,
    );
    expect(screen.getByText("Notes for the next agent (optional)")).toBeDefined();
    const textarea = screen.getByPlaceholderText(
      "Optional: anything the next agent should know...",
    );
    await userEvent.type(textarea, "  some context  ");
    await userEvent.click(screen.getByRole("button", { name: "Block" }));
    expect(onConfirm).toHaveBeenCalledWith("some context");
  });

  it("renders custom notes label and placeholder when provided", () => {
    render(
      <ConfirmDialog
        open={true}
        title="Block run"
        description="Provide context"
        confirmLabel="Block"
        notes={{ label: "Custom label", placeholder: "Custom placeholder" }}
        onConfirm={vi.fn()}
        onCancel={vi.fn()}
      />,
    );
    expect(screen.getByText("Custom label")).toBeDefined();
    expect(screen.getByPlaceholderText("Custom placeholder")).toBeDefined();
  });

  it("passes undefined for onConfirm note when notes prop exists but input is empty", async () => {
    const onConfirm = vi.fn();
    render(
      <ConfirmDialog
        open={true}
        title="Block run"
        description="Provide context"
        confirmLabel="Block"
        notes={{}}
        onConfirm={onConfirm}
        onCancel={vi.fn()}
      />,
    );
    await userEvent.click(screen.getByRole("button", { name: "Block" }));
    expect(onConfirm).toHaveBeenCalledWith(undefined);
  });

  it("passes undefined when notes input contains only whitespace", async () => {
    const onConfirm = vi.fn();
    render(
      <ConfirmDialog
        open={true}
        title="Block run"
        description="Provide context"
        confirmLabel="Block"
        notes={{}}
        onConfirm={onConfirm}
        onCancel={vi.fn()}
      />,
    );
    const textarea = screen.getByRole("textbox");
    await userEvent.type(textarea, "   ");
    await userEvent.click(screen.getByRole("button", { name: "Block" }));
    expect(onConfirm).toHaveBeenCalledWith(undefined);
  });

  it("shows the Working... spinner label and disables buttons/textarea when loading", () => {
    render(
      <ConfirmDialog
        open={true}
        title="Block run"
        description="Provide context"
        confirmLabel="Block"
        notes={{}}
        loading={true}
        onConfirm={vi.fn()}
        onCancel={vi.fn()}
      />,
    );
    expect(screen.getByText("Working...")).toBeDefined();
    expect(screen.queryByRole("button", { name: "Block" })).toBeNull();
    const cancelBtn = screen.getByRole("button", { name: "Cancel" }) as HTMLButtonElement;
    const confirmBtn = screen.getByText("Working...").closest("button") as HTMLButtonElement;
    expect(cancelBtn.disabled).toBe(true);
    expect(confirmBtn.disabled).toBe(true);
    const textarea = screen.getByRole("textbox") as HTMLTextAreaElement;
    expect(textarea.disabled).toBe(true);
  });

  it("applies destructive variant styling to the confirm button", () => {
    render(
      <ConfirmDialog
        open={true}
        title="Delete run"
        description="This cannot be undone"
        confirmLabel="Delete"
        variant="destructive"
        onConfirm={vi.fn()}
        onCancel={vi.fn()}
      />,
    );
    const confirmBtn = screen.getByRole("button", { name: "Delete" });
    expect(confirmBtn.className).toContain("bg-state-blocked");
  });

  it("clears the note after confirming", async () => {
    render(
      <ConfirmDialog
        open={true}
        title="Block run"
        description="Provide context"
        confirmLabel="Block"
        notes={{}}
        onConfirm={vi.fn()}
        onCancel={vi.fn()}
      />,
    );
    const textarea = screen.getByRole("textbox") as HTMLTextAreaElement;
    await userEvent.type(textarea, "context");
    await userEvent.click(screen.getByRole("button", { name: "Block" }));
    expect(textarea.value).toBe("");
  });

  it("clears the note after cancelling", async () => {
    render(
      <ConfirmDialog
        open={true}
        title="Block run"
        description="Provide context"
        confirmLabel="Block"
        notes={{}}
        onConfirm={vi.fn()}
        onCancel={vi.fn()}
      />,
    );
    const textarea = screen.getByRole("textbox") as HTMLTextAreaElement;
    await userEvent.type(textarea, "context");
    await userEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(textarea.value).toBe("");
  });
});
