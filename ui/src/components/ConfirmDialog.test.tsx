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
    expect(container.innerHTML).toBe("");
  });

  it("renders title, description and confirm label when open", () => {
    render(
      <ConfirmDialog
        open={true}
        title="Approve plan?"
        description="This will move the run forward."
        confirmLabel="Approve"
        onConfirm={vi.fn()}
        onCancel={vi.fn()}
      />,
    );
    expect(screen.getByText("Approve plan?")).toBeDefined();
    expect(screen.getByText("This will move the run forward.")).toBeDefined();
    expect(screen.getByRole("button", { name: "Approve" })).toBeDefined();
  });

  it("does not render the notes textarea when notes prop is omitted", () => {
    render(
      <ConfirmDialog
        open={true}
        title="Title"
        description="Description"
        confirmLabel="Confirm"
        onConfirm={vi.fn()}
        onCancel={vi.fn()}
      />,
    );
    expect(screen.queryByRole("textbox")).toBeNull();
  });

  it("renders notes textarea with default label/placeholder when notes prop is an empty object", () => {
    render(
      <ConfirmDialog
        open={true}
        title="Title"
        description="Description"
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

  it("renders custom notes label and placeholder when provided", () => {
    render(
      <ConfirmDialog
        open={true}
        title="Title"
        description="Description"
        confirmLabel="Confirm"
        notes={{ label: "Rejection reason", placeholder: "Why reject?" }}
        onConfirm={vi.fn()}
        onCancel={vi.fn()}
      />,
    );
    expect(screen.getByText("Rejection reason")).toBeDefined();
    expect(screen.getByPlaceholderText("Why reject?")).toBeDefined();
  });

  it("calls onConfirm with undefined when confirmed without notes prop", async () => {
    const onConfirm = vi.fn();
    render(
      <ConfirmDialog
        open={true}
        title="Title"
        description="Description"
        confirmLabel="Confirm"
        onConfirm={onConfirm}
        onCancel={vi.fn()}
      />,
    );
    await userEvent.click(screen.getByRole("button", { name: "Confirm" }));
    expect(onConfirm).toHaveBeenCalledTimes(1);
    expect(onConfirm).toHaveBeenCalledWith(undefined);
  });

  it("calls onConfirm with undefined when notes textarea is left empty", async () => {
    const onConfirm = vi.fn();
    render(
      <ConfirmDialog
        open={true}
        title="Title"
        description="Description"
        confirmLabel="Confirm"
        notes={{}}
        onConfirm={onConfirm}
        onCancel={vi.fn()}
      />,
    );
    await userEvent.click(screen.getByRole("button", { name: "Confirm" }));
    expect(onConfirm).toHaveBeenCalledWith(undefined);
  });

  it("calls onConfirm with the trimmed note text when notes are provided", async () => {
    const onConfirm = vi.fn();
    render(
      <ConfirmDialog
        open={true}
        title="Title"
        description="Description"
        confirmLabel="Confirm"
        notes={{}}
        onConfirm={onConfirm}
        onCancel={vi.fn()}
      />,
    );
    const textarea = screen.getByPlaceholderText(
      "Optional: anything the next agent should know...",
    );
    await userEvent.type(textarea, "  Watch out for flaky test X  ");
    await userEvent.click(screen.getByRole("button", { name: "Confirm" }));
    expect(onConfirm).toHaveBeenCalledWith("Watch out for flaky test X");
  });

  it("calls onConfirm with undefined when the note is only whitespace", async () => {
    const onConfirm = vi.fn();
    render(
      <ConfirmDialog
        open={true}
        title="Title"
        description="Description"
        confirmLabel="Confirm"
        notes={{}}
        onConfirm={onConfirm}
        onCancel={vi.fn()}
      />,
    );
    const textarea = screen.getByPlaceholderText(
      "Optional: anything the next agent should know...",
    );
    await userEvent.type(textarea, "   ");
    await userEvent.click(screen.getByRole("button", { name: "Confirm" }));
    expect(onConfirm).toHaveBeenCalledWith(undefined);
  });

  it("calls onCancel (not onConfirm) when Cancel is clicked", async () => {
    const onConfirm = vi.fn();
    const onCancel = vi.fn();
    render(
      <ConfirmDialog
        open={true}
        title="Title"
        description="Description"
        confirmLabel="Confirm"
        onConfirm={onConfirm}
        onCancel={onCancel}
      />,
    );
    await userEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(onCancel).toHaveBeenCalledTimes(1);
    expect(onConfirm).not.toHaveBeenCalled();
  });

  it("calls onCancel when the backdrop is clicked", async () => {
    const onCancel = vi.fn();
    const { container } = render(
      <ConfirmDialog
        open={true}
        title="Title"
        description="Description"
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

  it("shows the 'Working...' label and disables buttons/textarea when loading is true", () => {
    render(
      <ConfirmDialog
        open={true}
        title="Title"
        description="Description"
        confirmLabel="Confirm"
        loading={true}
        notes={{}}
        onConfirm={vi.fn()}
        onCancel={vi.fn()}
      />,
    );
    expect(screen.getByText("Working...")).toBeDefined();
    expect(screen.queryByText("Confirm")).toBeNull();
    const cancelBtn = screen.getByRole("button", { name: "Cancel" }) as HTMLButtonElement;
    const confirmBtn = screen.getByRole("button", { name: /Working/i }) as HTMLButtonElement;
    const textarea = screen.getByPlaceholderText(
      "Optional: anything the next agent should know...",
    ) as HTMLTextAreaElement;
    expect(cancelBtn.disabled).toBe(true);
    expect(confirmBtn.disabled).toBe(true);
    expect(textarea.disabled).toBe(true);
  });

  it("applies the destructive variant's styling class to the confirm button", () => {
    render(
      <ConfirmDialog
        open={true}
        title="Title"
        description="Description"
        confirmLabel="Delete"
        variant="destructive"
        onConfirm={vi.fn()}
        onCancel={vi.fn()}
      />,
    );
    const confirmBtn = screen.getByRole("button", { name: "Delete" });
    expect(confirmBtn.className).toContain("bg-state-blocked");
  });

  it("clears the note after a successful confirm", async () => {
    render(
      <ConfirmDialog
        open={true}
        title="Title"
        description="Description"
        confirmLabel="Confirm"
        notes={{}}
        onConfirm={vi.fn()}
        onCancel={vi.fn()}
      />,
    );
    const textarea = screen.getByPlaceholderText(
      "Optional: anything the next agent should know...",
    ) as HTMLTextAreaElement;
    await userEvent.type(textarea, "some note");
    expect(textarea.value).toBe("some note");
    await userEvent.click(screen.getByRole("button", { name: "Confirm" }));
    expect(textarea.value).toBe("");
  });
});
