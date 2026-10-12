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
  approvePlan: ReturnType<typeof vi.fn>;
  rejectPlan: ReturnType<typeof vi.fn>;
  reReviewPlan: ReturnType<typeof vi.fn>;
  revisePlan: ReturnType<typeof vi.fn>;
  approveReview: ReturnType<typeof vi.fn>;
  pauseRun: ReturnType<typeof vi.fn>;
  resumeRun: ReturnType<typeof vi.fn>;
  retryStage: ReturnType<typeof vi.fn>;
};

describe("ActionBar", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    for (const key of Object.keys(mockApi) as Array<keyof typeof mockApi>) {
      mockApi[key].mockResolvedValue({});
    }
  });

  it("renders nothing for a state with no applicable actions", () => {
    const { container } = render(
      <ActionBar runId="run-1" state="Done" onAction={vi.fn()} />,
    );
    expect(container.firstChild).toBeNull();
  });

  it("shows the Answer Questions button in HumanClarificationNeeded and calls onScrollToQuestions", async () => {
    const onScrollToQuestions = vi.fn();
    render(
      <ActionBar
        runId="run-1"
        state="HumanClarificationNeeded"
        onAction={vi.fn()}
        onScrollToQuestions={onScrollToQuestions}
      />,
    );
    await userEvent.click(screen.getByRole("button", { name: /answer questions/i }));
    expect(onScrollToQuestions).toHaveBeenCalledOnce();
  });

  it("shows the Answer Optional Questions button only when hasOptionalQuestions is true in AwaitingPlanApproval", () => {
    const { rerender } = render(
      <ActionBar
        runId="run-1"
        state="AwaitingPlanApproval"
        onAction={vi.fn()}
        hasOptionalQuestions={false}
      />,
    );
    expect(screen.queryByRole("button", { name: /answer optional questions/i })).toBeNull();

    rerender(
      <ActionBar
        runId="run-1"
        state="AwaitingPlanApproval"
        onAction={vi.fn()}
        hasOptionalQuestions={true}
      />,
    );
    expect(screen.getByRole("button", { name: /answer optional questions/i })).toBeDefined();
  });

  it("opens the Approve Plan confirm dialog and calls api.approvePlan with the note on confirm", async () => {
    const onAction = vi.fn();
    render(
      <ActionBar runId="run-1" state="AwaitingPlanApproval" onAction={onAction} />,
    );
    await userEvent.click(screen.getByRole("button", { name: /approve plan/i }));
    expect(
      screen.getByText(/This will approve the current plan/i),
    ).toBeDefined();

    await userEvent.type(screen.getByRole("textbox"), "extra context");
    await userEvent.click(screen.getByRole("button", { name: /approve & start/i }));

    await waitFor(() => {
      expect(mockApi.approvePlan).toHaveBeenCalledWith("run-1", "extra context");
      expect(onAction).toHaveBeenCalledOnce();
    });
  });

  it("does not call onAction when the confirmed action rejects, but still closes the dialog", async () => {
    mockApi.approvePlan.mockRejectedValue(new Error("boom"));
    const onAction = vi.fn();
    render(
      <ActionBar runId="run-1" state="AwaitingPlanApproval" onAction={onAction} />,
    );
    await userEvent.click(screen.getByRole("button", { name: /approve plan/i }));
    await userEvent.click(screen.getByRole("button", { name: /approve & start/i }));

    await waitFor(() => {
      expect(mockApi.approvePlan).toHaveBeenCalled();
    });
    expect(onAction).not.toHaveBeenCalled();
    expect(screen.queryByText(/This will approve the current plan/i)).toBeNull();
  });

  it("dismisses the Approve Plan dialog without calling the API when Cancel is clicked", async () => {
    render(
      <ActionBar runId="run-1" state="AwaitingPlanApproval" onAction={vi.fn()} />,
    );
    await userEvent.click(screen.getByRole("button", { name: /approve plan/i }));
    await userEvent.click(screen.getByRole("button", { name: /cancel/i }));
    expect(screen.queryByText(/This will approve the current plan/i)).toBeNull();
    expect(mockApi.approvePlan).not.toHaveBeenCalled();
  });

  it("opens the custom Reject Plan dialog, submits feedback, and calls api.rejectPlan with the selected mode", async () => {
    const onAction = vi.fn();
    render(
      <ActionBar runId="run-1" state="AwaitingPlanApproval" onAction={onAction} />,
    );
    await userEvent.click(screen.getByRole("button", { name: /^reject plan$/i }));

    expect(
      screen.getByText(/This will reject the current plan/i),
    ).toBeDefined();

    // Default mode is "Revise plan" (iterate); switch to "Start fresh" and
    // back to "Revise plan" to exercise both mode-toggle handlers.
    await userEvent.click(screen.getByRole("button", { name: /start fresh/i }));
    // Lowercase "p" distinguishes the in-dialog "Revise plan" mode toggle
    // from the page-level "Revise Plan" trigger button rendered behind it.
    await userEvent.click(screen.getByRole("button", { name: /^Revise plan/ }));
    await userEvent.click(screen.getByRole("button", { name: /start fresh/i }));
    await userEvent.type(
      screen.getByPlaceholderText(/describe what should change/i),
      "Needs more detail",
    );

    const confirmButtons = screen.getAllByRole("button", { name: /^reject plan$/i });
    // The second matching button is the dialog's confirm button.
    await userEvent.click(confirmButtons[confirmButtons.length - 1]);

    await waitFor(() => {
      expect(mockApi.rejectPlan).toHaveBeenCalledWith("run-1", "Needs more detail", "fresh");
      expect(onAction).toHaveBeenCalledOnce();
    });
  });

  it("cancels the Reject Plan dialog without calling the API", async () => {
    render(
      <ActionBar runId="run-1" state="AwaitingPlanApproval" onAction={vi.fn()} />,
    );
    await userEvent.click(screen.getByRole("button", { name: /^reject plan$/i }));
    await userEvent.click(screen.getByRole("button", { name: /cancel/i }));
    expect(screen.queryByText(/This will reject the current plan/i)).toBeNull();
    expect(mockApi.rejectPlan).not.toHaveBeenCalled();
  });

  it("shows Re-review Plan and Revise Plan buttons in AwaitingPlanApproval and triggers the right API calls", async () => {
    const onAction = vi.fn();
    render(
      <ActionBar runId="run-1" state="AwaitingPlanApproval" onAction={onAction} />,
    );

    await userEvent.click(screen.getByRole("button", { name: /re-review plan/i }));
    expect(
      screen.getByText(/Run the plan reviewer again against the current plan/i),
    ).toBeDefined();
    await userEvent.click(screen.getByRole("button", { name: /^re-review$/i }));
    await waitFor(() => {
      expect(mockApi.reReviewPlan).toHaveBeenCalledWith("run-1", undefined);
    });

    await userEvent.click(screen.getByRole("button", { name: /revise plan/i }));
    await userEvent.click(screen.getByRole("button", { name: /^revise$/i }));
    await waitFor(() => {
      expect(mockApi.revisePlan).toHaveBeenCalledWith("run-1", undefined);
      expect(onAction).toHaveBeenCalledTimes(2);
    });
  });

  it("shows Approve & Complete for ReadyForHumanReview and calls api.approveReview", async () => {
    const onAction = vi.fn();
    render(
      <ActionBar runId="run-1" state="ReadyForHumanReview" onAction={onAction} />,
    );
    await userEvent.click(screen.getByRole("button", { name: /approve & complete/i }));
    await userEvent.click(screen.getByRole("button", { name: /complete run/i }));
    await waitFor(() => {
      expect(mockApi.approveReview).toHaveBeenCalledWith("run-1");
      expect(onAction).toHaveBeenCalledOnce();
    });
  });

  it("shows Pause for an active-category state and calls api.pauseRun", async () => {
    render(<ActionBar runId="run-1" state="Planning" onAction={vi.fn()} />);
    await userEvent.click(screen.getByRole("button", { name: /^pause$/i }));
    const pauseButtons = screen.getAllByRole("button", { name: /^pause$/i });
    await userEvent.click(pauseButtons[pauseButtons.length - 1]);
    await waitFor(() => {
      expect(mockApi.pauseRun).toHaveBeenCalledWith("run-1");
    });
  });

  it("shows Resume for AIBlocked, HumanClarificationNeeded, and Failed and calls api.resumeRun", async () => {
    for (const state of ["AIBlocked", "HumanClarificationNeeded", "Failed"]) {
      const { unmount } = render(
        <ActionBar runId="run-1" state={state} onAction={vi.fn()} />,
      );
      expect(screen.getByRole("button", { name: /^resume$/i })).toBeDefined();
      unmount();
    }

    render(<ActionBar runId="run-1" state="AIBlocked" onAction={vi.fn()} />);
    await userEvent.click(screen.getByRole("button", { name: /^resume$/i }));
    const resumeButtons = screen.getAllByRole("button", { name: /^resume$/i });
    await userEvent.click(resumeButtons[resumeButtons.length - 1]);
    await waitFor(() => {
      expect(mockApi.resumeRun).toHaveBeenCalledWith("run-1");
    });
  });

  it("shows a stage-specific Retry label and calls api.retryStage", async () => {
    render(<ActionBar runId="run-1" state="Todo" onAction={vi.fn()} />);
    const retryBtn = screen.getByRole("button", { name: "Start Run" });
    await userEvent.click(retryBtn);
    await userEvent.click(screen.getByRole("button", { name: /^retry$/i }));
    await waitFor(() => {
      expect(mockApi.retryStage).toHaveBeenCalledWith("run-1");
    });
  });

  it("maps each retryable state to its specific retry label", () => {
    render(<ActionBar runId="run-1" state="Implementing" onAction={vi.fn()} />);
    expect(screen.getByRole("button", { name: "Retry Execution" })).toBeDefined();
  });
});
