import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

// ConfirmDialog is mocked here (and only here) to always render its confirm
// control regardless of the `open` prop, so we can exercise ActionBar's
// `handleConfirm` guard (`if (!dialog) return;`) — a defensive branch that is
// unreachable through the real ConfirmDialog, which never renders a confirm
// button while `open` is false.
vi.mock("./ConfirmDialog.tsx", () => ({
  ConfirmDialog: ({ onConfirm }: { onConfirm: (note?: string) => void }) => (
    <button onClick={() => onConfirm("note")}>mock-confirm</button>
  ),
}));

vi.mock("@/api/client.ts", () => ({
  api: {},
}));

import { ActionBar } from "./ActionBar.tsx";

describe("ActionBar handleConfirm guard", () => {
  it("no-ops and does not call onAction when confirmed while no dialog is active", async () => {
    const onAction = vi.fn();
    render(<ActionBar runId="run-1" state="AwaitingPlanApproval" onAction={onAction} />);

    // No action button was clicked, so internal `dialog` state is still null.
    await userEvent.click(screen.getByText("mock-confirm"));

    expect(onAction).not.toHaveBeenCalled();
  });
});
