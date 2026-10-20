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

  it("renders the title, description, and confirm label when open", () => {
    render(
      <ConfirmDialog
        open={true}
        title="Delete run"
        description="This cannot be undone."
        confirmLabel="Delete forever"
        onConfirm={vi.fn()}
        onCancel={vi.fn()}
      />,
    );
    expect(screen.getByText("Delete run")).toBeDefined();
    expect(screen.getByText("This cannot be undone.")).toBeDefined();
    expect(screen.getByRole("button", { name: "Delete forever" })).toBeDefined();
  });

  it("calls onConfirm with undefined when there is no notes prop", async () => {
    const onConfirm = vi.fn();
    render(
      <ConfirmDialog
        open={true}
        title="Confirm"
        description="desc"
        confirmLabel="Yes"
        onConfirm={onConfirm}
        onCancel={vi.fn()}
      />,
    );
    await userEvent.click(screen.getByRole("button", { name: "Yes" }));
    expect(onConfirm).toHaveBeenCalledWith(undefined);
  });

  it("calls onCancel when the Cancel button is clicked", async () => {
    const onCancel = vi.fn();
    render(
      <ConfirmDialog
        open={true}
        title="Confirm"
        description="desc"
        confirmLabel="Yes"
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
        title="Confirm"
        description="desc"
        confirmLabel="Yes"
        onConfirm={vi.fn()}
        onCancel={onCancel}
      />,
    );
    const backdrop = container.querySelector(".absolute.inset-0");
    expect(backdrop).toBeDefined();
    await userEvent.click(backdrop as Element);
    expect(onCancel).toHaveBeenCalledOnce();
  });

  it("does not render a notes textarea when the notes prop is omitted", () => {
    render(
      <ConfirmDialog
        open={true}
        title="Confirm"
        description="desc"
        confirmLabel="Yes"
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
        title="Confirm"
        description="desc"
        confirmLabel="Yes"
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

  it("renders a notes textarea with custom label/placeholder", () => {
    render(
      <ConfirmDialog
        open={true}
        title="Confirm"
        description="desc"
        confirmLabel="Yes"
        notes={{ label: "Custom label", placeholder: "Custom placeholder" }}
        onConfirm={vi.fn()}
        onCancel={vi.fn()}
      />,
    );
    expect(screen.getByText("Custom label")).toBeDefined();
    expect(screen.getByPlaceholderText("Custom placeholder")).toBeDefined();
  });

  it("calls onConfirm with the trimmed note text when notes are provided and filled in", async () => {
    const onConfirm = vi.fn();
    render(
      <ConfirmDialog
        open={true}
        title="Confirm"
        description="desc"
        confirmLabel="Yes"
        notes={{}}
        onConfirm={onConfirm}
        onCancel={vi.fn()}
      />,
    );
    const textarea = screen.getByRole("textbox");
    await userEvent.type(textarea, "  some note text  ");
    await userEvent.click(screen.getByRole("button", { name: "Yes" }));
    expect(onConfirm).toHaveBeenCalledWith("some note text");
  });

  it("calls onConfirm with undefined when notes prop is present but left empty", async () => {
    const onConfirm = vi.fn();
    render(
      <ConfirmDialog
        open={true}
        title="Confirm"
        description="desc"
        confirmLabel="Yes"
        notes={{}}
        onConfirm={onConfirm}
        onCancel={vi.fn()}
      />,
    );
    await userEvent.click(screen.getByRole("button", { name: "Yes" }));
    expect(onConfirm).toHaveBeenCalledWith(undefined);
  });

  it("calls onConfirm with undefined when the note is only whitespace", async () => {
    const onConfirm = vi.fn();
    render(
      <ConfirmDialog
        open={true}
        title="Confirm"
        description="desc"
        confirmLabel="Yes"
        notes={{}}
        onConfirm={onConfirm}
        onCancel={vi.fn()}
      />,
    );
    const textarea = screen.getByRole("textbox");
    await userEvent.type(textarea, "   ");
    await userEvent.click(screen.getByRole("button", { name: "Yes" }));
    expect(onConfirm).toHaveBeenCalledWith(undefined);
  });

  it("shows a 'Working...' loading state and disables buttons when loading is true", () => {
    render(
      <ConfirmDialog
        open={true}
        title="Confirm"
        description="desc"
        confirmLabel="Yes"
        loading={true}
        onConfirm={vi.fn()}
        onCancel={vi.fn()}
      />,
    );
    expect(screen.getByText("Working...")).toBeDefined();
    const confirmBtn = screen.getByText("Working...").closest("button");
    const cancelBtn = screen.getByRole("button", { name: "Cancel" });
    expect((confirmBtn as HTMLButtonElement).disabled).toBe(true);
    expect((cancelBtn as HTMLButtonElement).disabled).toBe(true);
  });

  it("disables the notes textarea while loading", () => {
    render(
      <ConfirmDialog
        open={true}
        title="Confirm"
        description="desc"
        confirmLabel="Yes"
        notes={{}}
        loading={true}
        onConfirm={vi.fn()}
        onCancel={vi.fn()}
      />,
    );
    const textarea = screen.getByRole("textbox") as HTMLTextAreaElement;
    expect(textarea.disabled).toBe(true);
  });

  it("applies the destructive styling class when variant is 'destructive'", () => {
    render(
      <ConfirmDialog
        open={true}
        title="Confirm"
        description="desc"
        confirmLabel="Yes"
        variant="destructive"
        onConfirm={vi.fn()}
        onCancel={vi.fn()}
      />,
    );
    const confirmBtn = screen.getByRole("button", { name: "Yes" });
    expect(confirmBtn.className).toContain("bg-state-blocked");
  });

  it("applies the default (accent) styling class when variant is omitted", () => {
    render(
      <ConfirmDialog
        open={true}
        title="Confirm"
        description="desc"
        confirmLabel="Yes"
        onConfirm={vi.fn()}
        onCancel={vi.fn()}
      />,
    );
    const confirmBtn = screen.getByRole("button", { name: "Yes" });
    expect(confirmBtn.className).toContain("bg-accent");
  });

  it("clears the note after a successful confirm (resets local state)", async () => {
    const onConfirm = vi.fn();
    render(
      <ConfirmDialog
        open={true}
        title="Confirm"
        description="desc"
        confirmLabel="Yes"
        notes={{}}
        onConfirm={onConfirm}
        onCancel={vi.fn()}
      />,
    );
    const textarea = screen.getByRole("textbox") as HTMLTextAreaElement;
    await userEvent.type(textarea, "note one");
    await userEvent.click(screen.getByRole("button", { name: "Yes" }));
    expect(onConfirm).toHaveBeenCalledWith("note one");
    expect(textarea.value).toBe("");
  });

  it("clears the note after cancel (resets local state)", async () => {
    render(
      <ConfirmDialog
        open={true}
        title="Confirm"
        description="desc"
        confirmLabel="Yes"
        notes={{}}
        onConfirm={vi.fn()}
        onCancel={vi.fn()}
      />,
    );
    const textarea = screen.getByRole("textbox") as HTMLTextAreaElement;
    await userEvent.type(textarea, "note to discard");
    await userEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(textarea.value).toBe("");
  });
});
