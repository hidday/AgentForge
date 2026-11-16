import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ConfirmDialog } from "./ConfirmDialog.tsx";

const baseProps = {
  open: true,
  title: "Approve plan?",
  description: "This will move the run forward.",
  confirmLabel: "Approve",
  onConfirm: vi.fn(),
  onCancel: vi.fn(),
};

describe("ConfirmDialog", () => {
  it("renders nothing when closed", () => {
    const { container } = render(<ConfirmDialog {...baseProps} open={false} />);
    expect(container.firstChild).toBeNull();
  });

  it("renders the title, description and confirm label when open", () => {
    render(<ConfirmDialog {...baseProps} />);
    expect(screen.getByText("Approve plan?")).toBeDefined();
    expect(screen.getByText("This will move the run forward.")).toBeDefined();
    expect(screen.getByRole("button", { name: "Approve" })).toBeDefined();
  });

  it("does not render a notes textarea when no notes prop is given", () => {
    render(<ConfirmDialog {...baseProps} />);
    expect(screen.queryByRole("textbox")).toBeNull();
  });

  it("calls onConfirm with no note when there is no notes prop", async () => {
    const onConfirm = vi.fn();
    render(<ConfirmDialog {...baseProps} onConfirm={onConfirm} />);
    await userEvent.click(screen.getByRole("button", { name: "Approve" }));
    expect(onConfirm).toHaveBeenCalledWith(undefined);
  });

  it("calls onCancel when the Cancel button is clicked", async () => {
    const onCancel = vi.fn();
    render(<ConfirmDialog {...baseProps} onCancel={onCancel} />);
    await userEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(onCancel).toHaveBeenCalledOnce();
  });

  it("calls onCancel when the backdrop is clicked", async () => {
    const onCancel = vi.fn();
    const { container } = render(<ConfirmDialog {...baseProps} onCancel={onCancel} />);
    const backdrop = container.querySelector(".backdrop-blur-sm") as HTMLElement;
    await userEvent.click(backdrop);
    expect(onCancel).toHaveBeenCalledOnce();
  });

  it("renders default notes label/placeholder and forwards the trimmed note on confirm", async () => {
    const onConfirm = vi.fn();
    render(<ConfirmDialog {...baseProps} onConfirm={onConfirm} notes={{}} />);

    expect(screen.getByText("Notes for the next agent (optional)")).toBeDefined();
    const textarea = screen.getByPlaceholderText(
      "Optional: anything the next agent should know...",
    );

    await userEvent.type(textarea, "  please check CI  ");
    await userEvent.click(screen.getByRole("button", { name: "Approve" }));

    expect(onConfirm).toHaveBeenCalledWith("please check CI");
  });

  it("renders a custom notes label and placeholder when provided", () => {
    render(
      <ConfirmDialog
        {...baseProps}
        notes={{ label: "Custom label", placeholder: "Custom placeholder" }}
      />,
    );
    expect(screen.getByText("Custom label")).toBeDefined();
    expect(screen.getByPlaceholderText("Custom placeholder")).toBeDefined();
  });

  it("calls onConfirm with undefined when the note is only whitespace", async () => {
    const onConfirm = vi.fn();
    render(<ConfirmDialog {...baseProps} onConfirm={onConfirm} notes={{}} />);

    const textarea = screen.getByRole("textbox");
    await userEvent.type(textarea, "   ");
    await userEvent.click(screen.getByRole("button", { name: "Approve" }));

    expect(onConfirm).toHaveBeenCalledWith(undefined);
  });

  it("clears the note after a successful confirm", async () => {
    render(<ConfirmDialog {...baseProps} notes={{}} />);
    const textarea = screen.getByRole("textbox") as HTMLTextAreaElement;

    await userEvent.type(textarea, "leftover note");
    await userEvent.click(screen.getByRole("button", { name: "Approve" }));

    expect(textarea.value).toBe("");
  });

  it("disables the buttons and textarea and shows a working indicator while loading", () => {
    render(<ConfirmDialog {...baseProps} loading notes={{}} />);

    expect(screen.getByText("Working...")).toBeDefined();
    expect(screen.queryByText("Approve")).toBeNull();
    expect((screen.getByRole("textbox") as HTMLTextAreaElement).disabled).toBe(true);
    expect((screen.getByRole("button", { name: "Cancel" }) as HTMLButtonElement).disabled).toBe(
      true,
    );
    const confirmBtn = screen.getByRole("button", { name: /working/i }) as HTMLButtonElement;
    expect(confirmBtn.disabled).toBe(true);
  });

  it("applies destructive styling when variant is 'destructive'", () => {
    render(<ConfirmDialog {...baseProps} variant="destructive" />);
    const confirmBtn = screen.getByRole("button", { name: "Approve" });
    expect(confirmBtn.className).toContain("bg-state-blocked");
  });

  it("applies default accent styling when no variant is given", () => {
    render(<ConfirmDialog {...baseProps} />);
    const confirmBtn = screen.getByRole("button", { name: "Approve" });
    expect(confirmBtn.className).toContain("bg-accent");
  });
});
