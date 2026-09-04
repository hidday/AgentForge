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
        confirmLabel="Go"
        onConfirm={vi.fn()}
        onCancel={vi.fn()}
      />,
    );
    expect(container.innerHTML).toBe("");
  });

  it("renders title, description, and confirm label when open", () => {
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
  });

  it("calls onConfirm with undefined when no notes prop is provided", async () => {
    const user = userEvent.setup();
    const onConfirm = vi.fn();
    render(
      <ConfirmDialog
        open={true}
        title="T"
        description="D"
        confirmLabel="Confirm"
        onConfirm={onConfirm}
        onCancel={vi.fn()}
      />,
    );
    // No notes textarea should be rendered.
    expect(screen.queryByRole("textbox")).toBeNull();

    await user.click(screen.getByRole("button", { name: "Confirm" }));
    expect(onConfirm).toHaveBeenCalledWith(undefined);
  });

  it("renders the notes textarea with custom label/placeholder and trims input before confirming", async () => {
    const user = userEvent.setup();
    const onConfirm = vi.fn();
    render(
      <ConfirmDialog
        open={true}
        title="T"
        description="D"
        confirmLabel="Confirm"
        notes={{ label: "Custom label", placeholder: "Custom placeholder" }}
        onConfirm={onConfirm}
        onCancel={vi.fn()}
      />,
    );

    expect(screen.getByText("Custom label")).toBeDefined();
    const textarea = screen.getByPlaceholderText("Custom placeholder");
    await user.type(textarea, "  some note  ");
    await user.click(screen.getByRole("button", { name: "Confirm" }));

    expect(onConfirm).toHaveBeenCalledWith("some note");
  });

  it("passes undefined to onConfirm when notes are provided but left blank/whitespace", async () => {
    const user = userEvent.setup();
    const onConfirm = vi.fn();
    render(
      <ConfirmDialog
        open={true}
        title="T"
        description="D"
        confirmLabel="Confirm"
        notes={{}}
        onConfirm={onConfirm}
        onCancel={vi.fn()}
      />,
    );

    const textarea = screen.getByPlaceholderText(
      "Optional: anything the next agent should know...",
    );
    await user.type(textarea, "   ");
    await user.click(screen.getByRole("button", { name: "Confirm" }));

    expect(onConfirm).toHaveBeenCalledWith(undefined);
  });

  it("resets the note field after confirming (does not persist to a subsequent open)", async () => {
    const user = userEvent.setup();
    const onConfirm = vi.fn();
    render(
      <ConfirmDialog
        open={true}
        title="T"
        description="D"
        confirmLabel="Confirm"
        notes={{}}
        onConfirm={onConfirm}
        onCancel={vi.fn()}
      />,
    );

    const textarea = screen.getByRole("textbox") as HTMLTextAreaElement;
    await user.type(textarea, "note text");
    expect(textarea.value).toBe("note text");

    await user.click(screen.getByRole("button", { name: "Confirm" }));
    expect((screen.getByRole("textbox") as HTMLTextAreaElement).value).toBe("");
  });

  it("calls onCancel and clears the note when Cancel is clicked", async () => {
    const user = userEvent.setup();
    const onCancel = vi.fn();
    render(
      <ConfirmDialog
        open={true}
        title="T"
        description="D"
        confirmLabel="Confirm"
        notes={{}}
        onConfirm={vi.fn()}
        onCancel={onCancel}
      />,
    );

    const textarea = screen.getByRole("textbox") as HTMLTextAreaElement;
    await user.type(textarea, "abandoned note");
    await user.click(screen.getByRole("button", { name: "Cancel" }));

    expect(onCancel).toHaveBeenCalledOnce();
  });

  it("calls onCancel when the backdrop is clicked", async () => {
    const user = userEvent.setup();
    const onCancel = vi.fn();
    const { container } = render(
      <ConfirmDialog
        open={true}
        title="T"
        description="D"
        confirmLabel="Confirm"
        onConfirm={vi.fn()}
        onCancel={onCancel}
      />,
    );

    const backdrop = container.querySelector(".absolute.inset-0");
    expect(backdrop).not.toBeNull();
    await user.click(backdrop as Element);
    expect(onCancel).toHaveBeenCalledOnce();
  });

  it("shows the destructive variant classes when variant is destructive", () => {
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
    const btn = screen.getByRole("button", { name: "Reject" });
    expect(btn.className).toContain("bg-state-blocked");
  });

  it("uses the default (non-destructive) variant classes when variant is omitted", () => {
    render(
      <ConfirmDialog
        open={true}
        title="T"
        description="D"
        confirmLabel="Confirm"
        onConfirm={vi.fn()}
        onCancel={vi.fn()}
      />,
    );
    const btn = screen.getByRole("button", { name: "Confirm" });
    expect(btn.className).toContain("bg-accent");
  });

  it("shows a loading state, disables buttons, and disables the textarea while loading", () => {
    render(
      <ConfirmDialog
        open={true}
        title="T"
        description="D"
        confirmLabel="Confirm"
        notes={{}}
        loading={true}
        onConfirm={vi.fn()}
        onCancel={vi.fn()}
      />,
    );

    expect(screen.getByText("Working...")).toBeDefined();
    expect(screen.queryByRole("button", { name: "Confirm" })).toBeNull();
    const cancelBtn = screen.getByRole("button", { name: "Cancel" });
    expect(cancelBtn).toHaveProperty("disabled", true);
    const confirmBtn = screen.getByText("Working...").closest("button");
    expect(confirmBtn).toHaveProperty("disabled", true);
    const textarea = screen.getByRole("textbox") as HTMLTextAreaElement;
    expect(textarea.disabled).toBe(true);
  });
});
