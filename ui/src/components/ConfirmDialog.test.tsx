import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ConfirmDialog } from "./ConfirmDialog.tsx";

describe("ConfirmDialog", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

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

  it("does not render a notes textarea when notes prop is absent", () => {
    render(
      <ConfirmDialog
        open={true}
        title="Title"
        description="Desc"
        confirmLabel="Confirm"
        onConfirm={vi.fn()}
        onCancel={vi.fn()}
      />,
    );
    expect(screen.queryByRole("textbox")).toBeNull();
  });

  it("renders default notes label and placeholder when notes prop has no overrides", () => {
    render(
      <ConfirmDialog
        open={true}
        title="Title"
        description="Desc"
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
        description="Desc"
        confirmLabel="Confirm"
        notes={{ label: "Custom label", placeholder: "Custom placeholder" }}
        onConfirm={vi.fn()}
        onCancel={vi.fn()}
      />,
    );
    expect(screen.getByText("Custom label")).toBeDefined();
    expect(screen.getByPlaceholderText("Custom placeholder")).toBeDefined();
  });

  it("calls onCancel and clears the note when Cancel button is clicked", async () => {
    const onCancel = vi.fn();
    render(
      <ConfirmDialog
        open={true}
        title="Title"
        description="Desc"
        confirmLabel="Confirm"
        notes={{}}
        onConfirm={vi.fn()}
        onCancel={onCancel}
      />,
    );
    const textarea = screen.getByRole("textbox") as HTMLTextAreaElement;
    await userEvent.type(textarea, "some note");
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
        description="Desc"
        confirmLabel="Confirm"
        onConfirm={vi.fn()}
        onCancel={onCancel}
      />,
    );
    const overlay = container.querySelector(".absolute.inset-0") as HTMLElement;
    expect(overlay).not.toBeNull();
    await userEvent.click(overlay);
    expect(onCancel).toHaveBeenCalledOnce();
  });

  it("calls onConfirm with undefined when there is no notes prop", async () => {
    const onConfirm = vi.fn();
    render(
      <ConfirmDialog
        open={true}
        title="Title"
        description="Desc"
        confirmLabel="Confirm"
        onConfirm={onConfirm}
        onCancel={vi.fn()}
      />,
    );
    await userEvent.click(screen.getByRole("button", { name: "Confirm" }));
    expect(onConfirm).toHaveBeenCalledWith(undefined);
  });

  it("calls onConfirm with undefined when notes prop is present but input is empty/whitespace", async () => {
    const onConfirm = vi.fn();
    render(
      <ConfirmDialog
        open={true}
        title="Title"
        description="Desc"
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

  it("calls onConfirm with the trimmed note text when notes are provided", async () => {
    const onConfirm = vi.fn();
    render(
      <ConfirmDialog
        open={true}
        title="Title"
        description="Desc"
        confirmLabel="Confirm"
        notes={{}}
        onConfirm={onConfirm}
        onCancel={vi.fn()}
      />,
    );
    const textarea = screen.getByRole("textbox") as HTMLTextAreaElement;
    await userEvent.type(textarea, "  hello agent  ");
    await userEvent.click(screen.getByRole("button", { name: "Confirm" }));
    expect(onConfirm).toHaveBeenCalledWith("hello agent");
    // note resets after confirm
    expect(textarea.value).toBe("");
  });

  it("uses default variant styling by default", () => {
    render(
      <ConfirmDialog
        open={true}
        title="Title"
        description="Desc"
        confirmLabel="Confirm"
        onConfirm={vi.fn()}
        onCancel={vi.fn()}
      />,
    );
    const btn = screen.getByRole("button", { name: "Confirm" });
    expect(btn.className).toContain("bg-accent");
    expect(btn.className).not.toContain("bg-state-blocked");
  });

  it("applies destructive variant styling when variant is destructive", () => {
    render(
      <ConfirmDialog
        open={true}
        title="Title"
        description="Desc"
        confirmLabel="Delete"
        variant="destructive"
        onConfirm={vi.fn()}
        onCancel={vi.fn()}
      />,
    );
    const btn = screen.getByRole("button", { name: "Delete" });
    expect(btn.className).toContain("bg-state-blocked");
  });

  it("shows a loading indicator and disables buttons/textarea when loading is true", () => {
    render(
      <ConfirmDialog
        open={true}
        title="Title"
        description="Desc"
        confirmLabel="Confirm"
        loading={true}
        notes={{}}
        onConfirm={vi.fn()}
        onCancel={vi.fn()}
      />,
    );
    expect(screen.getByText("Working...")).toBeDefined();
    expect(screen.queryByRole("button", { name: "Confirm" })).toBeNull();
    const cancelBtn = screen.getByRole("button", { name: "Cancel" }) as HTMLButtonElement;
    expect(cancelBtn.disabled).toBe(true);
    const confirmBtn = screen.getByText("Working...").closest("button") as HTMLButtonElement;
    expect(confirmBtn.disabled).toBe(true);
    const textarea = screen.getByRole("textbox") as HTMLTextAreaElement;
    expect(textarea.disabled).toBe(true);
  });

  it("does not show the loading indicator when loading is false or undefined", () => {
    render(
      <ConfirmDialog
        open={true}
        title="Title"
        description="Desc"
        confirmLabel="Confirm"
        onConfirm={vi.fn()}
        onCancel={vi.fn()}
      />,
    );
    expect(screen.queryByText("Working...")).toBeNull();
    expect(screen.getByRole("button", { name: "Confirm" })).toBeDefined();
  });
});
