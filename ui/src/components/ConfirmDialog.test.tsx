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
        description="This cannot be undone."
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
        description="This cannot be undone."
        confirmLabel="Delete"
        onConfirm={vi.fn()}
        onCancel={vi.fn()}
      />,
    );
    expect(screen.getByText("Delete run")).toBeDefined();
    expect(screen.getByText("This cannot be undone.")).toBeDefined();
    expect(screen.getByRole("button", { name: "Delete" })).toBeDefined();
  });

  it("calls onConfirm with no note when there is no notes field", async () => {
    const onConfirm = vi.fn();
    render(
      <ConfirmDialog
        open={true}
        title="Delete run"
        description="This cannot be undone."
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
        description="This cannot be undone."
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
        description="This cannot be undone."
        confirmLabel="Delete"
        onConfirm={vi.fn()}
        onCancel={onCancel}
      />,
    );

    const backdrop = container.querySelector(".absolute.inset-0") as HTMLElement;
    await userEvent.click(backdrop);
    expect(onCancel).toHaveBeenCalledOnce();
  });

  it("renders the notes textarea with defaults and forwards trimmed note on confirm", async () => {
    const onConfirm = vi.fn();
    render(
      <ConfirmDialog
        open={true}
        title="Reject plan"
        description="Explain why."
        confirmLabel="Reject"
        notes={{}}
        onConfirm={onConfirm}
        onCancel={vi.fn()}
      />,
    );

    expect(
      screen.getByText("Notes for the next agent (optional)"),
    ).toBeDefined();
    const textarea = screen.getByPlaceholderText(
      "Optional: anything the next agent should know...",
    );

    await userEvent.type(textarea, "  please check logs  ");
    await userEvent.click(screen.getByRole("button", { name: "Reject" }));

    expect(onConfirm).toHaveBeenCalledWith("please check logs");
  });

  it("uses custom notes label and placeholder when provided", () => {
    render(
      <ConfirmDialog
        open={true}
        title="Reject plan"
        description="Explain why."
        confirmLabel="Reject"
        notes={{ label: "Custom label", placeholder: "Custom placeholder" }}
        onConfirm={vi.fn()}
        onCancel={vi.fn()}
      />,
    );

    expect(screen.getByText("Custom label")).toBeDefined();
    expect(screen.getByPlaceholderText("Custom placeholder")).toBeDefined();
  });

  it("passes undefined note on confirm when notes textarea is left empty", async () => {
    const onConfirm = vi.fn();
    render(
      <ConfirmDialog
        open={true}
        title="Reject plan"
        description="Explain why."
        confirmLabel="Reject"
        notes={{}}
        onConfirm={onConfirm}
        onCancel={vi.fn()}
      />,
    );

    await userEvent.click(screen.getByRole("button", { name: "Reject" }));
    expect(onConfirm).toHaveBeenCalledWith(undefined);
  });

  it("shows a loading spinner and disables buttons and textarea while loading", () => {
    render(
      <ConfirmDialog
        open={true}
        title="Deleting"
        description="Please wait."
        confirmLabel="Delete"
        notes={{}}
        loading={true}
        onConfirm={vi.fn()}
        onCancel={vi.fn()}
      />,
    );

    expect(screen.getByText("Working...")).toBeDefined();
    expect(screen.queryByText("Delete")).toBeNull();
    expect(
      (screen.getByRole("button", { name: /cancel/i }) as HTMLButtonElement)
        .disabled,
    ).toBe(true);
    expect(
      (screen.getByRole("textbox") as HTMLTextAreaElement).disabled,
    ).toBe(true);
  });

  it("applies destructive variant styling when variant is destructive", () => {
    render(
      <ConfirmDialog
        open={true}
        title="Delete run"
        description="This cannot be undone."
        confirmLabel="Delete"
        variant="destructive"
        onConfirm={vi.fn()}
        onCancel={vi.fn()}
      />,
    );

    const confirmBtn = screen.getByRole("button", { name: "Delete" });
    expect(confirmBtn.className).toContain("bg-state-blocked");
  });

  it("applies default variant styling when variant is omitted", () => {
    render(
      <ConfirmDialog
        open={true}
        title="Confirm"
        description="Proceed?"
        confirmLabel="Confirm"
        onConfirm={vi.fn()}
        onCancel={vi.fn()}
      />,
    );

    const confirmBtn = screen.getByRole("button", { name: "Confirm" });
    expect(confirmBtn.className).toContain("bg-accent");
    expect(confirmBtn.className).not.toContain("bg-state-blocked");
  });
});
