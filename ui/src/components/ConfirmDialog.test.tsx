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

  it("renders title, description, and confirm label when open", () => {
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

  it("calls onConfirm with undefined when confirmed with no notes configured", async () => {
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
    const backdrop = container.querySelector(".backdrop-blur-sm")!;
    await userEvent.click(backdrop);
    expect(onCancel).toHaveBeenCalledOnce();
  });

  it("renders a notes textarea when notes prop is provided, with default label/placeholder", () => {
    render(
      <ConfirmDialog
        open={true}
        title="Reject plan"
        description="Explain why"
        confirmLabel="Reject"
        notes={{}}
        onConfirm={vi.fn()}
        onCancel={vi.fn()}
      />,
    );
    expect(screen.getByText(/Notes for the next agent \(optional\)/i)).toBeDefined();
    expect(screen.getByPlaceholderText(/Optional: anything the next agent/i)).toBeDefined();
  });

  it("uses custom notes label/placeholder when provided", () => {
    render(
      <ConfirmDialog
        open={true}
        title="Reject plan"
        description="Explain why"
        confirmLabel="Reject"
        notes={{ label: "Custom label", placeholder: "Custom placeholder" }}
        onConfirm={vi.fn()}
        onCancel={vi.fn()}
      />,
    );
    expect(screen.getByText("Custom label")).toBeDefined();
    expect(screen.getByPlaceholderText("Custom placeholder")).toBeDefined();
  });

  it("passes the trimmed note text to onConfirm when notes are entered", async () => {
    const onConfirm = vi.fn();
    render(
      <ConfirmDialog
        open={true}
        title="Reject plan"
        description="Explain why"
        confirmLabel="Reject"
        notes={{}}
        onConfirm={onConfirm}
        onCancel={vi.fn()}
      />,
    );
    const textarea = screen.getByPlaceholderText(/Optional: anything the next agent/i);
    await userEvent.type(textarea, "  needs more tests  ");
    await userEvent.click(screen.getByRole("button", { name: "Reject" }));
    expect(onConfirm).toHaveBeenCalledWith("needs more tests");
  });

  it("passes undefined to onConfirm when notes prop exists but input is empty/whitespace", async () => {
    const onConfirm = vi.fn();
    render(
      <ConfirmDialog
        open={true}
        title="Reject plan"
        description="Explain why"
        confirmLabel="Reject"
        notes={{}}
        onConfirm={onConfirm}
        onCancel={vi.fn()}
      />,
    );
    const textarea = screen.getByPlaceholderText(/Optional: anything the next agent/i);
    await userEvent.type(textarea, "   ");
    await userEvent.click(screen.getByRole("button", { name: "Reject" }));
    expect(onConfirm).toHaveBeenCalledWith(undefined);
  });

  it("clears the note field after confirming (so a re-open starts fresh)", async () => {
    render(
      <ConfirmDialog
        open={true}
        title="Reject plan"
        description="Explain why"
        confirmLabel="Reject"
        notes={{}}
        onConfirm={vi.fn()}
        onCancel={vi.fn()}
      />,
    );
    const textarea = screen.getByPlaceholderText(
      /Optional: anything the next agent/i,
    ) as HTMLTextAreaElement;
    await userEvent.type(textarea, "some note");
    await userEvent.click(screen.getByRole("button", { name: "Reject" }));
    expect(textarea.value).toBe("");
  });

  it("renders a spinner and 'Working...' label, and disables buttons, while loading", () => {
    render(
      <ConfirmDialog
        open={true}
        title="Delete run"
        description="Are you sure?"
        confirmLabel="Delete"
        loading={true}
        onConfirm={vi.fn()}
        onCancel={vi.fn()}
      />,
    );
    expect(screen.getByText(/working/i)).toBeDefined();
    expect((screen.getByRole("button", { name: "Cancel" }) as HTMLButtonElement).disabled).toBe(
      true,
    );
    expect(
      (screen.getByRole("button", { name: /working/i }) as HTMLButtonElement).disabled,
    ).toBe(true);
  });

  it("applies destructive styling when variant is 'destructive'", () => {
    render(
      <ConfirmDialog
        open={true}
        title="Delete run"
        description="Are you sure?"
        confirmLabel="Delete"
        variant="destructive"
        onConfirm={vi.fn()}
        onCancel={vi.fn()}
      />,
    );
    const confirmBtn = screen.getByRole("button", { name: "Delete" });
    expect(confirmBtn.className).toContain("bg-state-blocked");
  });

  it("disables the notes textarea while loading", () => {
    render(
      <ConfirmDialog
        open={true}
        title="Reject plan"
        description="Explain why"
        confirmLabel="Reject"
        notes={{}}
        loading={true}
        onConfirm={vi.fn()}
        onCancel={vi.fn()}
      />,
    );
    const textarea = screen.getByPlaceholderText(
      /Optional: anything the next agent/i,
    ) as HTMLTextAreaElement;
    expect(textarea.disabled).toBe(true);
  });
});
