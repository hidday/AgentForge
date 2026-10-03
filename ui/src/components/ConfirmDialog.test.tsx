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

  it("does not render the notes textarea when notes prop is omitted", () => {
    render(
      <ConfirmDialog
        open={true}
        title="Pause"
        description="Pause the run."
        confirmLabel="Pause"
        onConfirm={vi.fn()}
        onCancel={vi.fn()}
      />,
    );
    expect(screen.queryByRole("textbox")).toBeNull();
  });

  it("calls onConfirm with undefined when notes prop is provided but left empty", async () => {
    const onConfirm = vi.fn();
    render(
      <ConfirmDialog
        open={true}
        title="Re-review"
        description="desc"
        confirmLabel="Re-review"
        notes={{ label: "Notes", placeholder: "optional" }}
        onConfirm={onConfirm}
        onCancel={vi.fn()}
      />,
    );
    expect(screen.getByText("Notes")).toBeDefined();
    await userEvent.click(screen.getByRole("button", { name: "Re-review" }));
    expect(onConfirm).toHaveBeenCalledWith(undefined);
  });

  it("calls onConfirm with trimmed note text when notes textarea has content", async () => {
    const onConfirm = vi.fn();
    render(
      <ConfirmDialog
        open={true}
        title="Approve"
        description="desc"
        confirmLabel="Approve"
        notes={{ label: "Notes for executor", placeholder: "..." }}
        onConfirm={onConfirm}
        onCancel={vi.fn()}
      />,
    );
    const textarea = screen.getByPlaceholderText("...");
    await userEvent.type(textarea, "  watch the edge cases  ");
    await userEvent.click(screen.getByRole("button", { name: "Approve" }));
    expect(onConfirm).toHaveBeenCalledWith("watch the edge cases");
  });

  it("clears the note after confirming", async () => {
    const onConfirm = vi.fn();
    render(
      <ConfirmDialog
        open={true}
        title="Approve"
        description="desc"
        confirmLabel="Approve"
        notes={{}}
        onConfirm={onConfirm}
        onCancel={vi.fn()}
      />,
    );
    const textarea = screen.getByRole("textbox");
    await userEvent.type(textarea, "some note");
    await userEvent.click(screen.getByRole("button", { name: "Approve" }));
    expect((textarea as HTMLTextAreaElement).value).toBe("");
  });

  it("calls onCancel and clears the note when Cancel button is clicked", async () => {
    const onCancel = vi.fn();
    render(
      <ConfirmDialog
        open={true}
        title="Approve"
        description="desc"
        confirmLabel="Approve"
        notes={{}}
        onConfirm={vi.fn()}
        onCancel={onCancel}
      />,
    );
    const textarea = screen.getByRole("textbox");
    await userEvent.type(textarea, "draft note");
    await userEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(onCancel).toHaveBeenCalledTimes(1);
    expect((textarea as HTMLTextAreaElement).value).toBe("");
  });

  it("calls onCancel when the backdrop is clicked", async () => {
    const onCancel = vi.fn();
    const { container } = render(
      <ConfirmDialog
        open={true}
        title="Approve"
        description="desc"
        confirmLabel="Approve"
        onConfirm={vi.fn()}
        onCancel={onCancel}
      />,
    );
    const backdrop = container.querySelector(".absolute.inset-0");
    expect(backdrop).not.toBeNull();
    await userEvent.click(backdrop as Element);
    expect(onCancel).toHaveBeenCalledTimes(1);
  });

  it("shows the 'Working...' indicator and disables buttons when loading is true", () => {
    render(
      <ConfirmDialog
        open={true}
        title="Approve"
        description="desc"
        confirmLabel="Approve"
        loading={true}
        onConfirm={vi.fn()}
        onCancel={vi.fn()}
      />,
    );
    expect(screen.getByText("Working...")).toBeDefined();
    expect((screen.getByRole("button", { name: "Cancel" }) as HTMLButtonElement).disabled).toBe(
      true,
    );
    expect(
      (screen.getByText("Working...").closest("button") as HTMLButtonElement).disabled,
    ).toBe(true);
  });

  it("disables the notes textarea when loading is true", () => {
    render(
      <ConfirmDialog
        open={true}
        title="Approve"
        description="desc"
        confirmLabel="Approve"
        notes={{}}
        loading={true}
        onConfirm={vi.fn()}
        onCancel={vi.fn()}
      />,
    );
    expect((screen.getByRole("textbox") as HTMLTextAreaElement).disabled).toBe(true);
  });

  it("applies the destructive style to the confirm button when variant is destructive", () => {
    render(
      <ConfirmDialog
        open={true}
        title="Reject"
        description="desc"
        confirmLabel="Reject"
        variant="destructive"
        onConfirm={vi.fn()}
        onCancel={vi.fn()}
      />,
    );
    const confirmBtn = screen.getByRole("button", { name: "Reject" });
    expect(confirmBtn.className).toContain("bg-state-blocked");
  });

  it("applies the default accent style to the confirm button when no variant is given", () => {
    render(
      <ConfirmDialog
        open={true}
        title="Approve"
        description="desc"
        confirmLabel="Approve"
        onConfirm={vi.fn()}
        onCancel={vi.fn()}
      />,
    );
    const confirmBtn = screen.getByRole("button", { name: "Approve" });
    expect(confirmBtn.className).toContain("bg-accent");
  });
});
