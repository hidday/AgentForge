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
    expect(container).toBeEmptyDOMElement();
  });

  it("renders title, description and confirm label when open", () => {
    render(
      <ConfirmDialog
        open={true}
        title="Approve Plan"
        description="This will approve the plan"
        confirmLabel="Approve & Start"
        onConfirm={vi.fn()}
        onCancel={vi.fn()}
      />,
    );
    expect(screen.getByText("Approve Plan")).toBeInTheDocument();
    expect(screen.getByText("This will approve the plan")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Approve & Start" })).toBeInTheDocument();
  });

  it("calls onConfirm with undefined when no notes prop is given", async () => {
    const user = userEvent.setup();
    const onConfirm = vi.fn();
    render(
      <ConfirmDialog
        open={true}
        title="t"
        description="d"
        confirmLabel="Go"
        onConfirm={onConfirm}
        onCancel={vi.fn()}
      />,
    );
    await user.click(screen.getByRole("button", { name: "Go" }));
    expect(onConfirm).toHaveBeenCalledWith(undefined);
    expect(screen.queryByRole("textbox")).not.toBeInTheDocument();
  });

  it("renders a notes textarea with custom label/placeholder and forwards trimmed text to onConfirm", async () => {
    const user = userEvent.setup();
    const onConfirm = vi.fn();
    render(
      <ConfirmDialog
        open={true}
        title="t"
        description="d"
        confirmLabel="Go"
        notes={{ label: "Notes label", placeholder: "Type here..." }}
        onConfirm={onConfirm}
        onCancel={vi.fn()}
      />,
    );
    expect(screen.getByText("Notes label")).toBeInTheDocument();
    const textarea = screen.getByPlaceholderText("Type here...");
    await user.type(textarea, "  hello world  ");
    await user.click(screen.getByRole("button", { name: "Go" }));
    expect(onConfirm).toHaveBeenCalledWith("hello world");
  });

  it("passes undefined to onConfirm when notes prop is present but input is only whitespace", async () => {
    const user = userEvent.setup();
    const onConfirm = vi.fn();
    render(
      <ConfirmDialog
        open={true}
        title="t"
        description="d"
        confirmLabel="Go"
        notes={{}}
        onConfirm={onConfirm}
        onCancel={vi.fn()}
      />,
    );
    const textarea = screen.getByPlaceholderText("Optional: anything the next agent should know...");
    await user.type(textarea, "   ");
    await user.click(screen.getByRole("button", { name: "Go" }));
    expect(onConfirm).toHaveBeenCalledWith(undefined);
    expect(screen.getByText("Notes for the next agent (optional)")).toBeInTheDocument();
  });

  it("resets the note field after confirming so a reopen starts blank", async () => {
    const user = userEvent.setup();
    const onConfirm = vi.fn();
    const { rerender } = render(
      <ConfirmDialog
        open={true}
        title="t"
        description="d"
        confirmLabel="Go"
        notes={{}}
        onConfirm={onConfirm}
        onCancel={vi.fn()}
      />,
    );
    const textarea = screen.getByRole("textbox");
    await user.type(textarea, "note text");
    await user.click(screen.getByRole("button", { name: "Go" }));

    rerender(
      <ConfirmDialog
        open={false}
        title="t"
        description="d"
        confirmLabel="Go"
        notes={{}}
        onConfirm={onConfirm}
        onCancel={vi.fn()}
      />,
    );
    rerender(
      <ConfirmDialog
        open={true}
        title="t"
        description="d"
        confirmLabel="Go"
        notes={{}}
        onConfirm={onConfirm}
        onCancel={vi.fn()}
      />,
    );
    expect(screen.getByRole("textbox")).toHaveValue("");
  });

  it("calls onCancel and clears the note when Cancel is clicked", async () => {
    const user = userEvent.setup();
    const onCancel = vi.fn();
    render(
      <ConfirmDialog
        open={true}
        title="t"
        description="d"
        confirmLabel="Go"
        notes={{}}
        onConfirm={vi.fn()}
        onCancel={onCancel}
      />,
    );
    await user.type(screen.getByRole("textbox"), "draft");
    await user.click(screen.getByRole("button", { name: "Cancel" }));
    expect(onCancel).toHaveBeenCalledTimes(1);
  });

  it("calls onCancel when the backdrop is clicked", async () => {
    const user = userEvent.setup();
    const onCancel = vi.fn();
    const { container } = render(
      <ConfirmDialog
        open={true}
        title="t"
        description="d"
        confirmLabel="Go"
        onConfirm={vi.fn()}
        onCancel={onCancel}
      />,
    );
    const backdrop = container.querySelector(".absolute.inset-0") as HTMLElement;
    await user.click(backdrop);
    expect(onCancel).toHaveBeenCalledTimes(1);
  });

  it("disables cancel/confirm buttons and shows a working indicator when loading", () => {
    render(
      <ConfirmDialog
        open={true}
        title="t"
        description="d"
        confirmLabel="Go"
        loading={true}
        onConfirm={vi.fn()}
        onCancel={vi.fn()}
      />,
    );
    expect(screen.getByRole("button", { name: "Cancel" })).toBeDisabled();
    expect(screen.getByText("Working...")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Go" })).not.toBeInTheDocument();
  });

  it("applies destructive styling when variant is destructive", () => {
    render(
      <ConfirmDialog
        open={true}
        title="t"
        description="d"
        confirmLabel="Delete"
        variant="destructive"
        onConfirm={vi.fn()}
        onCancel={vi.fn()}
      />,
    );
    const confirmBtn = screen.getByRole("button", { name: "Delete" });
    expect(confirmBtn.className).toContain("bg-state-blocked");
  });

  it("applies default styling when variant is omitted", () => {
    render(
      <ConfirmDialog
        open={true}
        title="t"
        description="d"
        confirmLabel="Ok"
        onConfirm={vi.fn()}
        onCancel={vi.fn()}
      />,
    );
    const confirmBtn = screen.getByRole("button", { name: "Ok" });
    expect(confirmBtn.className).toContain("bg-accent");
  });

  it("textarea is disabled while loading", () => {
    render(
      <ConfirmDialog
        open={true}
        title="t"
        description="d"
        confirmLabel="Ok"
        notes={{}}
        loading={true}
        onConfirm={vi.fn()}
        onCancel={vi.fn()}
      />,
    );
    expect(screen.getByRole("textbox")).toBeDisabled();
  });
});
