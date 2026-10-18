import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ActionBar } from "./ActionBar.tsx";

vi.mock("@/api/client.ts", () => ({
  api: {
    approvePlan: vi.fn(),
    rejectPlan: vi.fn(),
    reReviewPlan: vi.fn(),
    revisePlan: vi.fn(),
    approveReview: vi.fn(),
    pauseRun: vi.fn(),
    resumeRun: vi.fn(),
    retryStage: vi.fn(),
  },
}));

import { api } from "@/api/client.ts";

const mockApi = api as unknown as {
  rejectPlan: ReturnType<typeof vi.fn>;
};

const RUN_ID = "run-1";

// Covers switching the reject dialog's mode back to "iterate" after having
// switched it to "fresh" — the "Revise plan" (iterate) toggle button's
// onClick is otherwise never exercised since "iterate" is already the
// default mode on dialog open.
describe("ActionBar – reject dialog mode toggle", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockApi.rejectPlan.mockResolvedValue({ ok: true, state: "rejected" });
  });

  it("switches the reject mode from 'fresh' back to 'iterate' and submits with that mode", async () => {
    const onAction = vi.fn();
    render(
      <ActionBar runId={RUN_ID} state="AwaitingPlanApproval" onAction={onAction} />,
    );

    await userEvent.click(screen.getByRole("button", { name: "Reject Plan" }));

    const freshBtn = screen.getByText("Start fresh").closest("button") as HTMLButtonElement;
    const iterateBtn = screen.getByText("Revise plan").closest("button") as HTMLButtonElement;

    // Switch to "fresh" first so the mode is no longer the default.
    await userEvent.click(freshBtn);
    expect(freshBtn.className).toContain("bg-accent");
    expect(iterateBtn.className).not.toContain("bg-accent");

    // Now switch back to "iterate" — this exercises the previously-uncovered
    // onClick handler for the iterate toggle button.
    await userEvent.click(iterateBtn);
    expect(iterateBtn.className).toContain("bg-accent");
    expect(freshBtn.className).not.toContain("bg-accent");

    const confirmBtn = screen.getAllByRole("button", { name: "Reject Plan" })[1];
    await userEvent.click(confirmBtn);

    expect(mockApi.rejectPlan).toHaveBeenCalledWith(RUN_ID, undefined, "iterate");
  });
});
