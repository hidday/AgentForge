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
        open={true}
        title="Approve Plan"
        description="This will approve it."
        confirmLabel="Approve & Start"
        onConfirm={vi.fn()}
        onCancel={vi.fn()}
      />,
    );
    expect(screen.getByText("Approve Plan")).toBeDefined();
    expect(screen.getByText("This will approve it.")).toBeDefined();
    expect(screen.getByRole("button", { name: "Approve & Start" })).toBeDefined();
  });

  it("does not render a notes textarea when notes prop is omitted", () => {
    render(
      <ConfirmDialog
        open={true}
        title="T"
        description="D"
        confirmLabel="Go"
        onConfirm={vi.fn()}
        onCancel={vi.fn()}
      />,
    );
    expect(screen.queryByRole("textbox")).toBeNull();
  });

  it("calls onConfirm with undefined when no notes prop is given", async () => {
    const onConfirm = vi.fn();
    render(
      <ConfirmDialog
        open={true}
        title="T"
        description="D"
        confirmLabel="Go"
        onConfirm={onConfirm}
        onCancel={vi.fn()}
      />,
    );
    await userEvent.click(screen.getByRole("button", { name: "Go" }));
    expect(onConfirm).toHaveBeenCalledWith(undefined);
  });

  it("renders the notes textarea with default label/placeholder when notes={}", () => {
    render(
      <ConfirmDialog
        open={true}
        title="T"
        description="D"
        confirmLabel="Go"
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

  it("renders custom notes label and placeholder when provided", () => {
    render(
      <ConfirmDialog
        open={true}
        title="T"
        description="D"
        confirmLabel="Go"
        notes={{ label: "Custom label", placeholder: "Custom placeholder" }}
        onConfirm={vi.fn()}
        onCancel={vi.fn()}
      />,
    );
    expect(screen.getByText("Custom label")).toBeDefined();
    expect(screen.getByPlaceholderText("Custom placeholder")).toBeDefined();
  });

  it("calls onConfirm with the trimmed note text when notes are entered", async () => {
    const onConfirm = vi.fn();
    render(
      <ConfirmDialog
        open={true}
        title="T"
        description="D"
        confirmLabel="Go"
        notes={{}}
        onConfirm={onConfirm}
        onCancel={vi.fn()}
      />,
    );
    const textarea = screen.getByRole("textbox");
    await userEvent.type(textarea, "  some note text  ");
    await userEvent.click(screen.getByRole("button", { name: "Go" }));
    expect(onConfirm).toHaveBeenCalledWith("some note text");
  });

  it("calls onConfirm with undefined when notes prop exists but input is empty/whitespace", async () => {
    const onConfirm = vi.fn();
    render(
      <ConfirmDialog
        open={true}
        title="T"
        description="D"
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

  it("clears the note field after confirming (note state resets)", async () => {
    const onConfirm = vi.fn();
    render(
      <ConfirmDialog
        open={true}
        title="T"
        description="D"
        confirmLabel="Go"
        notes={{}}
        onConfirm={onConfirm}
        onCancel={vi.fn()}
      />,
    );
    const textarea = screen.getByRole("textbox") as HTMLTextAreaElement;
    await userEvent.type(textarea, "note text");
    await userEvent.click(screen.getByRole("button", { name: "Go" }));
    expect(textarea.value).toBe("");
  });

  it("calls onCancel when the Cancel button is clicked and clears notes", async () => {
    const onCancel = vi.fn();
    render(
      <ConfirmDialog
        open={true}
        title="T"
        description="D"
        confirmLabel="Go"
        notes={{}}
        onConfirm={vi.fn()}
        onCancel={onCancel}
      />,
    );
    const textarea = screen.getByRole("textbox") as HTMLTextAreaElement;
    await userEvent.type(textarea, "abandoned note");
    await userEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(onCancel).toHaveBeenCalledOnce();
    expect(textarea.value).toBe("");
  });

  it("calls onCancel when the backdrop is clicked", async () => {
    const onCancel = vi.fn();
    const { container } = render(
      <ConfirmDialog
        open={true}
        title="T"
        description="D"
        confirmLabel="Go"
        onConfirm={vi.fn()}
        onCancel={onCancel}
      />,
    );
    const backdrop = container.querySelector(".absolute.inset-0") as HTMLElement;
    await userEvent.click(backdrop);
    expect(onCancel).toHaveBeenCalledOnce();
  });

  it("shows the default variant styling and 'Working...' label with spinner when loading", () => {
    render(
      <ConfirmDialog
        open={true}
        title="T"
        description="D"
        confirmLabel="Go"
        loading={true}
        onConfirm={vi.fn()}
        onCancel={vi.fn()}
      />,
    );
    expect(screen.getByText("Working...")).toBeDefined();
    expect(screen.queryByText("Go")).toBeNull();
  });

  it("disables Cancel and Confirm buttons while loading", () => {
    render(
      <ConfirmDialog
        open={true}
        title="T"
        description="D"
        confirmLabel="Go"
        loading={true}
        notes={{}}
        onConfirm={vi.fn()}
        onCancel={vi.fn()}
      />,
    );
    expect((screen.getByRole("button", { name: "Cancel" }) as HTMLButtonElement).disabled).toBe(
      true,
    );
    const confirmBtn = screen.getByRole("button", { name: /working/i });
    expect((confirmBtn as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByRole("textbox") as HTMLTextAreaElement).disabled).toBe(true);
  });

  it("applies destructive variant styling when variant='destructive'", () => {
    render(
      <ConfirmDialog
        open={true}
        title="T"
        description="D"
        confirmLabel="Reject"
        variant="destructive"
        onConfirm={vi.fn()}
        onCancel={vi.fn()}
      />,
    );
    const confirmBtn = screen.getByRole("button", { name: "Reject" });
    expect(confirmBtn.className).toContain("state-blocked");
  });

  it("applies default variant styling when variant is omitted", () => {
    render(
      <ConfirmDialog
        open={true}
        title="T"
        description="D"
        confirmLabel="Approve"
        onConfirm={vi.fn()}
        onCancel={vi.fn()}
      />,
    );
    const confirmBtn = screen.getByRole("button", { name: "Approve" });
    expect(confirmBtn.className).toContain("bg-accent");
  });
});
