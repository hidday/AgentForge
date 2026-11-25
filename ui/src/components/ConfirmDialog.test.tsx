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
        title="Pause Run"
        description="Pause it."
        confirmLabel="Pause"
        onConfirm={vi.fn()}
        onCancel={vi.fn()}
      />,
    );

    expect(screen.queryByRole("textbox")).toBeNull();
  });

  it("calls onConfirm with undefined when confirmed without notes", async () => {
    const onConfirm = vi.fn();
    render(
      <ConfirmDialog
        open={true}
        title="Pause Run"
        description="Pause it."
        confirmLabel="Pause"
        onConfirm={onConfirm}
        onCancel={vi.fn()}
      />,
    );

    await userEvent.click(screen.getByRole("button", { name: "Pause" }));
    expect(onConfirm).toHaveBeenCalledWith(undefined);
  });

  it("calls onConfirm with the trimmed note text when notes are provided", async () => {
    const onConfirm = vi.fn();
    render(
      <ConfirmDialog
        open={true}
        title="Approve Plan"
        description="Desc"
        confirmLabel="Approve & Start"
        notes={{ label: "Notes", placeholder: "..." }}
        onConfirm={onConfirm}
        onCancel={vi.fn()}
      />,
    );

    const textarea = screen.getByRole("textbox");
    await userEvent.type(textarea, "  careful with migrations  ");
    await userEvent.click(screen.getByRole("button", { name: "Approve & Start" }));

    expect(onConfirm).toHaveBeenCalledWith("careful with migrations");
  });

  it("calls onConfirm with undefined when notes are provided but left blank/whitespace", async () => {
    const onConfirm = vi.fn();
    render(
      <ConfirmDialog
        open={true}
        title="Approve Plan"
        description="Desc"
        confirmLabel="Approve & Start"
        notes={{ label: "Notes" }}
        onConfirm={onConfirm}
        onCancel={vi.fn()}
      />,
    );

    const textarea = screen.getByRole("textbox");
    await userEvent.type(textarea, "   ");
    await userEvent.click(screen.getByRole("button", { name: "Approve & Start" }));

    expect(onConfirm).toHaveBeenCalledWith(undefined);
  });

  it("uses default notes label/placeholder when notes object provides none", () => {
    render(
      <ConfirmDialog
        open={true}
        title="Approve Plan"
        description="Desc"
        confirmLabel="Approve"
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

  it("clears the note field after confirming (state resets)", async () => {
    const onConfirm = vi.fn();
    render(
      <ConfirmDialog
        open={true}
        title="Approve Plan"
        description="Desc"
        confirmLabel="Approve"
        notes={{}}
        onConfirm={onConfirm}
        onCancel={vi.fn()}
      />,
    );

    const textarea = screen.getByRole("textbox") as HTMLTextAreaElement;
    await userEvent.type(textarea, "hello");
    expect(textarea.value).toBe("hello");

    await userEvent.click(screen.getByRole("button", { name: "Approve" }));
    expect(textarea.value).toBe("");
  });

  it("calls onCancel and clears the note field when cancel is clicked", async () => {
    const onCancel = vi.fn();
    render(
      <ConfirmDialog
        open={true}
        title="Approve Plan"
        description="Desc"
        confirmLabel="Approve"
        notes={{}}
        onConfirm={vi.fn()}
        onCancel={onCancel}
      />,
    );

    const textarea = screen.getByRole("textbox") as HTMLTextAreaElement;
    await userEvent.type(textarea, "scratch note");

    await userEvent.click(screen.getByRole("button", { name: "Cancel" }));

    expect(onCancel).toHaveBeenCalledOnce();
    expect(textarea.value).toBe("");
  });

  it("calls onCancel when the backdrop is clicked", async () => {
    const onCancel = vi.fn();
    const { container } = render(
      <ConfirmDialog
        open={true}
        title="Approve Plan"
        description="Desc"
        confirmLabel="Approve"
        onConfirm={vi.fn()}
        onCancel={onCancel}
      />,
    );

    const backdrop = container.querySelector(".absolute.inset-0") as HTMLElement;
    await userEvent.click(backdrop);
    expect(onCancel).toHaveBeenCalledOnce();
  });

  it("shows a 'Working...' indicator and disables both buttons while loading", () => {
    render(
      <ConfirmDialog
        open={true}
        title="Approve Plan"
        description="Desc"
        confirmLabel="Approve"
        loading={true}
        onConfirm={vi.fn()}
        onCancel={vi.fn()}
      />,
    );

    expect(screen.getByText("Working...")).toBeDefined();
    expect(screen.queryByRole("button", { name: "Approve" })).toBeNull();
    expect((screen.getByRole("button", { name: "Cancel" }) as HTMLButtonElement).disabled).toBe(
      true,
    );
  });

  it("disables the notes textarea while loading", () => {
    render(
      <ConfirmDialog
        open={true}
        title="Approve Plan"
        description="Desc"
        confirmLabel="Approve"
        loading={true}
        notes={{}}
        onConfirm={vi.fn()}
        onCancel={vi.fn()}
      />,
    );

    expect((screen.getByRole("textbox") as HTMLTextAreaElement).disabled).toBe(true);
  });
});
