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

  it("renders the notes textarea with default label/placeholder when notes prop has no overrides", () => {
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
        notes={{ label: "Custom label", placeholder: "Custom placeholder" }}
        onConfirm={vi.fn()}
        onCancel={vi.fn()}
      />,
    );
    expect(screen.getByText("Custom label")).toBeDefined();
    expect(screen.getByPlaceholderText("Custom placeholder")).toBeDefined();
  });

  it("calls onConfirm with the trimmed note text when notes are provided and typed", async () => {
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
    const textarea = screen.getByRole("textbox");
    await userEvent.type(textarea, "  some notes  ");
    await userEvent.click(screen.getByRole("button", { name: "Confirm" }));
    expect(onConfirm).toHaveBeenCalledWith("some notes");
  });

  it("calls onConfirm with undefined when notes textarea is left blank or whitespace-only", async () => {
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
    const textarea = screen.getByRole("textbox");
    await userEvent.type(textarea, "   ");
    await userEvent.click(screen.getByRole("button", { name: "Confirm" }));
    expect(onConfirm).toHaveBeenCalledWith(undefined);
  });

  it("calls onConfirm with undefined when no notes prop is configured at all", async () => {
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

  it("clears the note text after confirming (textarea resets)", async () => {
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
    const textarea = screen.getByRole("textbox") as HTMLTextAreaElement;
    await userEvent.type(textarea, "draft note");
    expect(textarea.value).toBe("draft note");
    await userEvent.click(screen.getByRole("button", { name: "Confirm" }));
    expect(textarea.value).toBe("");
  });

  it("calls onCancel and clears note text when Cancel button is clicked", async () => {
    const onCancel = vi.fn();
    render(
      <ConfirmDialog
        open={true}
        title="Title"
        description="Description"
        confirmLabel="Confirm"
        notes={{}}
        onConfirm={vi.fn()}
        onCancel={onCancel}
      />,
    );
    const textarea = screen.getByRole("textbox") as HTMLTextAreaElement;
    await userEvent.type(textarea, "note to discard");
    await userEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(onCancel).toHaveBeenCalledOnce();
    expect(textarea.value).toBe("");
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
    expect(backdrop).toBeTruthy();
    await userEvent.click(backdrop);
    expect(onCancel).toHaveBeenCalledOnce();
  });

  it("shows the default (non-destructive) confirm button styling by default", () => {
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

  it("shows a loading state: 'Working...' text and disabled buttons/textarea", () => {
    render(
      <ConfirmDialog
        open={true}
        title="Title"
        description="Description"
        confirmLabel="Confirm"
        notes={{}}
        loading={true}
        onConfirm={vi.fn()}
        onCancel={vi.fn()}
      />,
    );
    expect(screen.getByText("Working...")).toBeDefined();
    expect(screen.queryByRole("button", { name: "Confirm" })).toBeNull();
    const cancelBtn = screen.getByRole("button", { name: "Cancel" }) as HTMLButtonElement;
    expect(cancelBtn.disabled).toBe(true);
    const textarea = screen.getByRole("textbox") as HTMLTextAreaElement;
    expect(textarea.disabled).toBe(true);
  });

  it("shows the confirmLabel text (not 'Working...') and enabled buttons when loading is false", () => {
    render(
      <ConfirmDialog
        open={true}
        title="Title"
        description="Description"
        confirmLabel="Confirm"
        loading={false}
        onConfirm={vi.fn()}
        onCancel={vi.fn()}
      />,
    );
    expect(screen.queryByText("Working...")).toBeNull();
    const confirmBtn = screen.getByRole("button", { name: "Confirm" }) as HTMLButtonElement;
    expect(confirmBtn.disabled).toBe(false);
  });
});
