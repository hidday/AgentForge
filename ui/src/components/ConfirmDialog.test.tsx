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

  it("calls onConfirm with undefined when there is no notes field", async () => {
    const onConfirm = vi.fn();
    render(
      <ConfirmDialog
        open={true}
        title="t"
        description="d"
        confirmLabel="Confirm"
        onConfirm={onConfirm}
        onCancel={vi.fn()}
      />,
    );
    await userEvent.click(screen.getByRole("button", { name: "Confirm" }));
    expect(onConfirm).toHaveBeenCalledWith(undefined);
  });

  it("does not render a notes textarea when notes prop is omitted", () => {
    render(
      <ConfirmDialog
        open={true}
        title="t"
        description="d"
        confirmLabel="Confirm"
        onConfirm={vi.fn()}
        onCancel={vi.fn()}
      />,
    );
    expect(screen.queryByRole("textbox")).toBeNull();
  });

  it("renders a notes textarea with default label/placeholder when notes={}", () => {
    render(
      <ConfirmDialog
        open={true}
        title="t"
        description="d"
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
        title="t"
        description="d"
        confirmLabel="Confirm"
        notes={{ label: "Custom label", placeholder: "Custom placeholder" }}
        onConfirm={vi.fn()}
        onCancel={vi.fn()}
      />,
    );
    expect(screen.getByText("Custom label")).toBeDefined();
    expect(screen.getByPlaceholderText("Custom placeholder")).toBeDefined();
  });

  it("passes the trimmed note to onConfirm when notes are provided and filled in", async () => {
    const onConfirm = vi.fn();
    render(
      <ConfirmDialog
        open={true}
        title="t"
        description="d"
        confirmLabel="Confirm"
        notes={{}}
        onConfirm={onConfirm}
        onCancel={vi.fn()}
      />,
    );
    const textarea = screen.getByRole("textbox");
    await userEvent.type(textarea, "  my note  ");
    await userEvent.click(screen.getByRole("button", { name: "Confirm" }));
    expect(onConfirm).toHaveBeenCalledWith("my note");
  });

  it("passes undefined to onConfirm when notes are provided but left blank", async () => {
    const onConfirm = vi.fn();
    render(
      <ConfirmDialog
        open={true}
        title="t"
        description="d"
        confirmLabel="Confirm"
        notes={{}}
        onConfirm={onConfirm}
        onCancel={vi.fn()}
      />,
    );
    await userEvent.click(screen.getByRole("button", { name: "Confirm" }));
    expect(onConfirm).toHaveBeenCalledWith(undefined);
  });

  it("calls onCancel when the Cancel button is clicked", async () => {
    const onCancel = vi.fn();
    render(
      <ConfirmDialog
        open={true}
        title="t"
        description="d"
        confirmLabel="Confirm"
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
        title="t"
        description="d"
        confirmLabel="Confirm"
        onConfirm={vi.fn()}
        onCancel={onCancel}
      />,
    );
    const backdrop = container.querySelector(".absolute.inset-0") as HTMLElement;
    await userEvent.click(backdrop);
    expect(onCancel).toHaveBeenCalledOnce();
  });

  it("shows a 'Working...' label and disables buttons when loading is true", () => {
    render(
      <ConfirmDialog
        open={true}
        title="t"
        description="d"
        confirmLabel="Confirm"
        loading={true}
        onConfirm={vi.fn()}
        onCancel={vi.fn()}
      />,
    );
    expect(screen.getByText("Working...")).toBeDefined();
    expect((screen.getByRole("button", { name: "Cancel" }) as HTMLButtonElement).disabled).toBe(
      true,
    );
  });

  it("applies destructive styling when variant is 'destructive'", () => {
    render(
      <ConfirmDialog
        open={true}
        title="t"
        description="d"
        confirmLabel="Reject"
        variant="destructive"
        onConfirm={vi.fn()}
        onCancel={vi.fn()}
      />,
    );
    const confirmBtn = screen.getByRole("button", { name: "Reject" });
    expect(confirmBtn.className).toContain("bg-state-blocked");
  });

  it("disables the notes textarea while loading", () => {
    render(
      <ConfirmDialog
        open={true}
        title="t"
        description="d"
        confirmLabel="Confirm"
        notes={{}}
        loading={true}
        onConfirm={vi.fn()}
        onCancel={vi.fn()}
      />,
    );
    expect((screen.getByRole("textbox") as HTMLTextAreaElement).disabled).toBe(true);
  });
});
