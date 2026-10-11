import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
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

describe("ActionBar additional branches", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("switching from 'Start fresh' back to 'Revise plan' re-selects iterate mode", async () => {
    mockApi.rejectPlan.mockResolvedValue({});
    render(<ActionBar runId={RUN_ID} state="AwaitingPlanApproval" onAction={vi.fn()} />);

    await userEvent.click(screen.getByRole("button", { name: /^reject plan$/i }));

    const reviseButton = screen.getByText("Revise plan").closest("button")!;
    const freshButton = screen.getByText("Start fresh").closest("button")!;

    // Switch to fresh mode first.
    await userEvent.click(freshButton);
    expect(freshButton.className).toContain("bg-accent");
    expect(reviseButton.className).not.toContain("bg-accent");

    // Now switch back to iterate mode via the "Revise plan" toggle button.
    await userEvent.click(reviseButton);
    expect(reviseButton.className).toContain("bg-accent");
    expect(freshButton.className).not.toContain("bg-accent");

    const confirmButtons = screen.getAllByRole("button", { name: /reject plan/i });
    await userEvent.click(confirmButtons[confirmButtons.length - 1]);

    await waitFor(() => {
      expect(mockApi.rejectPlan).toHaveBeenCalledWith(RUN_ID, undefined, "iterate");
    });
  });
});
