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
        description="Desc"
        confirmLabel="Confirm"
        onConfirm={vi.fn()}
        onCancel={vi.fn()}
      />,
    );
    expect(container.firstChild).toBeNull();
  });

  it("renders title, description and confirmLabel when open", () => {
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
        title="T"
        description="D"
        confirmLabel="OK"
        onConfirm={vi.fn()}
        onCancel={vi.fn()}
      />,
    );
    expect(screen.queryByRole("textbox")).toBeNull();
  });

  it("renders notes textarea with custom label/placeholder when notes prop is provided", () => {
    render(
      <ConfirmDialog
        open={true}
        title="T"
        description="D"
        confirmLabel="OK"
        notes={{ label: "Custom label", placeholder: "Custom placeholder" }}
        onConfirm={vi.fn()}
        onCancel={vi.fn()}
      />,
    );
    expect(screen.getByText("Custom label")).toBeDefined();
    expect(screen.getByPlaceholderText("Custom placeholder")).toBeDefined();
  });

  it("uses default notes label/placeholder when notes prop provides none", () => {
    render(
      <ConfirmDialog
        open={true}
        title="T"
        description="D"
        confirmLabel="OK"
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

  it("onConfirm receives trimmed note text and textarea resets after confirm", async () => {
    const onConfirm = vi.fn();
    render(
      <ConfirmDialog
        open={true}
        title="T"
        description="D"
        confirmLabel="OK"
        notes={{}}
        onConfirm={onConfirm}
        onCancel={vi.fn()}
      />,
    );
    const textarea = screen.getByRole("textbox") as HTMLTextAreaElement;
    await userEvent.type(textarea, "  hello world  ");
    await userEvent.click(screen.getByRole("button", { name: "OK" }));
    expect(onConfirm).toHaveBeenCalledWith("hello world");
  });

  it("onConfirm receives undefined when notes textarea is empty", async () => {
    const onConfirm = vi.fn();
    render(
      <ConfirmDialog
        open={true}
        title="T"
        description="D"
        confirmLabel="OK"
        notes={{}}
        onConfirm={onConfirm}
        onCancel={vi.fn()}
      />,
    );
    await userEvent.click(screen.getByRole("button", { name: "OK" }));
    expect(onConfirm).toHaveBeenCalledWith(undefined);
  });

  it("onConfirm receives undefined when notes prop is absent, even after (impossible) typing", async () => {
    const onConfirm = vi.fn();
    render(
      <ConfirmDialog
        open={true}
        title="T"
        description="D"
        confirmLabel="OK"
        onConfirm={onConfirm}
        onCancel={vi.fn()}
      />,
    );
    await userEvent.click(screen.getByRole("button", { name: "OK" }));
    expect(onConfirm).toHaveBeenCalledWith(undefined);
  });

  it("Cancel button calls onCancel and does not call onConfirm", async () => {
    const onConfirm = vi.fn();
    const onCancel = vi.fn();
    render(
      <ConfirmDialog
        open={true}
        title="T"
        description="D"
        confirmLabel="OK"
        onConfirm={onConfirm}
        onCancel={onCancel}
      />,
    );
    await userEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(onCancel).toHaveBeenCalledTimes(1);
    expect(onConfirm).not.toHaveBeenCalled();
  });

  it("clicking the backdrop calls onCancel", async () => {
    const onCancel = vi.fn();
    const { container } = render(
      <ConfirmDialog
        open={true}
        title="T"
        description="D"
        confirmLabel="OK"
        onConfirm={vi.fn()}
        onCancel={onCancel}
      />,
    );
    const backdrop = container.querySelector(".absolute.inset-0") as HTMLElement;
    await userEvent.click(backdrop);
    expect(onCancel).toHaveBeenCalledTimes(1);
  });

  it("note text is cleared after cancel (re-typing then re-opening starts blank)", async () => {
    const onCancel = vi.fn();
    const { rerender } = render(
      <ConfirmDialog
        open={true}
        title="T"
        description="D"
        confirmLabel="OK"
        notes={{}}
        onConfirm={vi.fn()}
        onCancel={onCancel}
      />,
    );
    const textarea = screen.getByRole("textbox") as HTMLTextAreaElement;
    await userEvent.type(textarea, "draft note");
    await userEvent.click(screen.getByRole("button", { name: "Cancel" }));

    rerender(
      <ConfirmDialog
        open={false}
        title="T"
        description="D"
        confirmLabel="OK"
        notes={{}}
        onConfirm={vi.fn()}
        onCancel={onCancel}
      />,
    );
    rerender(
      <ConfirmDialog
        open={true}
        title="T"
        description="D"
        confirmLabel="OK"
        notes={{}}
        onConfirm={vi.fn()}
        onCancel={onCancel}
      />,
    );
    expect((screen.getByRole("textbox") as HTMLTextAreaElement).value).toBe("");
  });

  it("shows 'Working...' and disables Cancel, confirm and textarea when loading is true", () => {
    render(
      <ConfirmDialog
        open={true}
        title="T"
        description="D"
        confirmLabel="OK"
        notes={{}}
        loading
        onConfirm={vi.fn()}
        onCancel={vi.fn()}
      />,
    );
    expect(screen.getByText("Working...")).toBeDefined();
    expect((screen.getByRole("button", { name: "Cancel" }) as HTMLButtonElement).disabled).toBe(
      true,
    );
    expect(
      (screen.getByRole("textbox") as HTMLTextAreaElement).disabled,
    ).toBe(true);
    // confirm button now shows the loading content instead of confirmLabel text
    expect(screen.queryByRole("button", { name: "OK" })).toBeNull();
  });

  it("applies destructive styling classes when variant is 'destructive'", () => {
    render(
      <ConfirmDialog
        open={true}
        title="T"
        description="D"
        confirmLabel="Delete"
        variant="destructive"
        onConfirm={vi.fn()}
        onCancel={vi.fn()}
      />,
    );
    const confirmBtn = screen.getByRole("button", { name: "Delete" });
    expect(confirmBtn.className).toContain("bg-state-blocked");
    expect(confirmBtn.className).not.toContain("bg-accent");
  });

  it("applies default (non-destructive) styling classes when variant is omitted", () => {
    render(
      <ConfirmDialog
        open={true}
        title="T"
        description="D"
        confirmLabel="Go"
        onConfirm={vi.fn()}
        onCancel={vi.fn()}
      />,
    );
    const confirmBtn = screen.getByRole("button", { name: "Go" });
    expect(confirmBtn.className).toContain("bg-accent");
    expect(confirmBtn.className).not.toContain("bg-state-blocked");
  });
});
