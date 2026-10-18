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

  it("renders title, description and confirm label when open", () => {
    render(
      <ConfirmDialog
        open={true}
        title="Approve Plan"
        description="This will approve the current plan."
        confirmLabel="Approve & Start"
        onConfirm={vi.fn()}
        onCancel={vi.fn()}
      />,
    );

    expect(screen.getByText("Approve Plan")).toBeDefined();
    expect(screen.getByText("This will approve the current plan.")).toBeDefined();
    expect(screen.getByRole("button", { name: "Approve & Start" })).toBeDefined();
    expect(screen.getByRole("button", { name: "Cancel" })).toBeDefined();
  });

  it("applies default (non-destructive) styling to the confirm button", () => {
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
    const confirmBtn = screen.getByRole("button", { name: "Confirm" });
    expect(confirmBtn.className).toContain("bg-accent");
    expect(confirmBtn.className).not.toContain("bg-state-blocked");
  });

  it("applies destructive styling to the confirm button when variant is destructive", () => {
    render(
      <ConfirmDialog
        open={true}
        title="Title"
        description="Description"
        confirmLabel="Reject"
        variant="destructive"
        onConfirm={vi.fn()}
        onCancel={vi.fn()}
      />,
    );
    const confirmBtn = screen.getByRole("button", { name: "Reject" });
    expect(confirmBtn.className).toContain("bg-state-blocked");
  });

  it("does not render a notes textarea when notes prop is omitted", () => {
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

  it("renders the notes textarea with label/placeholder when notes prop is provided", () => {
    render(
      <ConfirmDialog
        open={true}
        title="Title"
        description="Description"
        confirmLabel="Confirm"
        notes={{ label: "Notes for the executor", placeholder: "e.g. extra context" }}
        onConfirm={vi.fn()}
        onCancel={vi.fn()}
      />,
    );
    expect(screen.getByText("Notes for the executor")).toBeDefined();
    const textarea = screen.getByPlaceholderText("e.g. extra context") as HTMLTextAreaElement;
    expect(textarea).toBeDefined();
  });

  it("renders default notes label/placeholder when notes object has no label/placeholder", () => {
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

  it("calls onConfirm with the trimmed note text when notes are provided and filled", async () => {
    const onConfirm = vi.fn();
    render(
      <ConfirmDialog
        open={true}
        title="Title"
        description="Description"
        confirmLabel="Confirm"
        notes={{ label: "Notes" }}
        onConfirm={onConfirm}
        onCancel={vi.fn()}
      />,
    );

    const textarea = screen.getByRole("textbox");
    await userEvent.type(textarea, "  hello world  ");
    await userEvent.click(screen.getByRole("button", { name: "Confirm" }));

    expect(onConfirm).toHaveBeenCalledWith("hello world");
  });

  it("calls onConfirm with undefined when notes are provided but left empty", async () => {
    const onConfirm = vi.fn();
    render(
      <ConfirmDialog
        open={true}
        title="Title"
        description="Description"
        confirmLabel="Confirm"
        notes={{ label: "Notes" }}
        onConfirm={onConfirm}
        onCancel={vi.fn()}
      />,
    );

    await userEvent.click(screen.getByRole("button", { name: "Confirm" }));
    expect(onConfirm).toHaveBeenCalledWith(undefined);
  });

  it("calls onConfirm with undefined when no notes prop is given at all", async () => {
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
    expect(onConfirm).toHaveBeenCalledWith(undefined);
  });

  it("clears the note after confirming, so a subsequent open starts blank", async () => {
    const onConfirm = vi.fn();
    render(
      <ConfirmDialog
        open={true}
        title="Title"
        description="Description"
        confirmLabel="Confirm"
        notes={{ label: "Notes" }}
        onConfirm={onConfirm}
        onCancel={vi.fn()}
      />,
    );

    const textarea = screen.getByRole("textbox") as HTMLTextAreaElement;
    await userEvent.type(textarea, "first note");
    await userEvent.click(screen.getByRole("button", { name: "Confirm" }));
    expect(onConfirm).toHaveBeenCalledWith("first note");
    expect(textarea.value).toBe("");
  });

  it("calls onCancel when the Cancel button is clicked", async () => {
    const onCancel = vi.fn();
    render(
      <ConfirmDialog
        open={true}
        title="Title"
        description="Description"
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
        title="Title"
        description="Description"
        confirmLabel="Confirm"
        onConfirm={vi.fn()}
        onCancel={onCancel}
      />,
    );

    const backdrop = container.querySelector(".absolute.inset-0") as HTMLElement;
    expect(backdrop).toBeDefined();
    await userEvent.click(backdrop);
    expect(onCancel).toHaveBeenCalledOnce();
  });

  it("disables buttons and textarea and shows a working indicator when loading", () => {
    render(
      <ConfirmDialog
        open={true}
        title="Title"
        description="Description"
        confirmLabel="Confirm"
        notes={{ label: "Notes" }}
        loading={true}
        onConfirm={vi.fn()}
        onCancel={vi.fn()}
      />,
    );

    const confirmBtn = screen.getByRole("button", { name: /working/i }) as HTMLButtonElement;
    const cancelBtn = screen.getByRole("button", { name: "Cancel" }) as HTMLButtonElement;
    const textarea = screen.getByRole("textbox") as HTMLTextAreaElement;

    expect(confirmBtn.disabled).toBe(true);
    expect(cancelBtn.disabled).toBe(true);
    expect(textarea.disabled).toBe(true);
    expect(screen.queryByText("Confirm")).toBeNull();
  });

  it("shows the confirm label (not the working indicator) when not loading", () => {
    render(
      <ConfirmDialog
        open={true}
        title="Title"
        description="Description"
        confirmLabel="Go"
        onConfirm={vi.fn()}
        onCancel={vi.fn()}
      />,
    );

    expect(screen.getByRole("button", { name: "Go" })).toBeDefined();
    expect(screen.queryByText(/working/i)).toBeNull();
  });
});
