import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

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

import { ActionBar } from "./ActionBar.tsx";
import { api } from "@/api/client.ts";

const mockApi = api as unknown as Record<string, ReturnType<typeof vi.fn>>;

const RUN_ID = "run-1";

describe("ActionBar", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    for (const fn of Object.values(mockApi)) fn.mockResolvedValue({ ok: true });
  });

  it("renders nothing when state has no applicable actions and no questions", () => {
    const { container } = render(
      <ActionBar runId={RUN_ID} state="Done" onAction={vi.fn()} />,
    );
    expect(container.innerHTML).toBe("");
  });

  it("shows Approve Plan and Reject Plan for AwaitingPlanApproval, and confirming Approve calls api.approvePlan + onAction", async () => {
    const onAction = vi.fn();
    render(<ActionBar runId={RUN_ID} state="AwaitingPlanApproval" onAction={onAction} />);

    expect(screen.getByText("Approve Plan")).toBeDefined();
    expect(screen.getByText("Reject Plan")).toBeDefined();

    await userEvent.click(screen.getByText("Approve Plan"));
    // Confirm dialog appears
    expect(screen.getByText("Approve & Start")).toBeDefined();
    await userEvent.click(screen.getByText("Approve & Start"));

    await waitFor(() => {
      expect(mockApi.approvePlan).toHaveBeenCalledWith(RUN_ID, undefined);
      expect(onAction).toHaveBeenCalledTimes(1);
    });
  });

  it("does not call onAction when the confirmed action rejects", async () => {
    mockApi.approvePlan.mockRejectedValue(new Error("boom"));
    const onAction = vi.fn();
    render(<ActionBar runId={RUN_ID} state="AwaitingPlanApproval" onAction={onAction} />);

    await userEvent.click(screen.getByText("Approve Plan"));
    await userEvent.click(screen.getByText("Approve & Start"));

    await waitFor(() => {
      expect(mockApi.approvePlan).toHaveBeenCalled();
    });
    expect(onAction).not.toHaveBeenCalled();
    // dialog should have closed despite the rejection
    expect(screen.queryByText("Approve & Start")).toBeNull();
  });

  it("Reject Plan opens a custom dialog; confirming sends trimmed feedback and selected mode", async () => {
    const onAction = vi.fn();
    render(<ActionBar runId={RUN_ID} state="AwaitingPlanApproval" onAction={onAction} />);

    await userEvent.click(screen.getByText("Reject Plan"));
    expect(screen.getByText("Start fresh")).toBeDefined();

    await userEvent.click(screen.getByText("Start fresh"));
    const textarea = screen.getByPlaceholderText(/describe what should change/i);
    await userEvent.type(textarea, "  please redo step 2  ");

    // The trigger button in the header and the dialog's submit button both read
    // "Reject Plan" — the dialog's submit button is rendered last.
    const rejectButtons = screen.getAllByRole("button", { name: "Reject Plan" });
    await userEvent.click(rejectButtons[rejectButtons.length - 1]);

    await waitFor(() => {
      expect(mockApi.rejectPlan).toHaveBeenCalledWith(RUN_ID, "please redo step 2", "fresh");
      expect(onAction).toHaveBeenCalledTimes(1);
    });
  });

  it("Reject dialog cancel button closes without calling the API", async () => {
    render(<ActionBar runId={RUN_ID} state="AwaitingPlanApproval" onAction={vi.fn()} />);
    await userEvent.click(screen.getByText("Reject Plan"));
    await userEvent.click(screen.getByText("Cancel"));

    expect(screen.queryByText("Start fresh")).toBeNull();
    expect(mockApi.rejectPlan).not.toHaveBeenCalled();
  });

  it("shows Approve & Complete for ReadyForHumanReview and calls api.approveReview", async () => {
    const onAction = vi.fn();
    render(<ActionBar runId={RUN_ID} state="ReadyForHumanReview" onAction={onAction} />);
    await userEvent.click(screen.getByText("Approve & Complete"));
    await userEvent.click(screen.getByText("Complete Run"));

    await waitFor(() => {
      expect(mockApi.approveReview).toHaveBeenCalledWith(RUN_ID);
      expect(onAction).toHaveBeenCalledTimes(1);
    });
  });

  it("shows Pause for an active-category state and calls api.pauseRun", async () => {
    render(<ActionBar runId={RUN_ID} state="Planning" onAction={vi.fn()} />);
    await userEvent.click(screen.getByRole("button", { name: "Pause" }));
    const pauseButtons = screen.getAllByRole("button", { name: "Pause" });
    await userEvent.click(pauseButtons[pauseButtons.length - 1]);

    await waitFor(() => {
      expect(mockApi.pauseRun).toHaveBeenCalledWith(RUN_ID);
    });
  });

  it("shows Resume for AIBlocked and calls api.resumeRun", async () => {
    render(<ActionBar runId={RUN_ID} state="AIBlocked" onAction={vi.fn()} />);
    await userEvent.click(screen.getByRole("button", { name: "Resume" }));
    const resumeButtons = screen.getAllByRole("button", { name: "Resume" });
    await userEvent.click(resumeButtons[resumeButtons.length - 1]);

    await waitFor(() => {
      expect(mockApi.resumeRun).toHaveBeenCalledWith(RUN_ID);
    });
  });

  it("HumanClarificationNeeded shows Answer Questions button that calls onScrollToQuestions, plus Resume", async () => {
    const onScrollToQuestions = vi.fn();
    render(
      <ActionBar
        runId={RUN_ID}
        state="HumanClarificationNeeded"
        onAction={vi.fn()}
        onScrollToQuestions={onScrollToQuestions}
      />,
    );
    await userEvent.click(screen.getByText("Answer Questions"));
    expect(onScrollToQuestions).toHaveBeenCalledTimes(1);
    expect(screen.getByText("Resume")).toBeDefined();
  });

  it("uses the RETRY_LABELS mapping for a retryable stage and calls api.retryStage", async () => {
    render(<ActionBar runId={RUN_ID} state="Implementing" onAction={vi.fn()} />);
    const btn = screen.getByText("Retry Execution");
    await userEvent.click(btn);
    await userEvent.click(screen.getByText("Retry", { selector: "button" }));

    await waitFor(() => {
      expect(mockApi.retryStage).toHaveBeenCalledWith(RUN_ID);
    });
  });

  it("shows Answer Optional Questions button only when hasOptionalQuestions is true for AwaitingPlanApproval", () => {
    const { rerender } = render(
      <ActionBar runId={RUN_ID} state="AwaitingPlanApproval" onAction={vi.fn()} />,
    );
    expect(screen.queryByText("Answer Optional Questions")).toBeNull();

    rerender(
      <ActionBar
        runId={RUN_ID}
        state="AwaitingPlanApproval"
        onAction={vi.fn()}
        hasOptionalQuestions
      />,
    );
    expect(screen.getByText("Answer Optional Questions")).toBeDefined();
  });

  it("Re-review Plan and Revise Plan dialogs call their respective api methods with notes", async () => {
    const onAction = vi.fn();
    render(<ActionBar runId={RUN_ID} state="AwaitingPlanApproval" onAction={onAction} />);

    await userEvent.click(screen.getByText("Re-review Plan"));
    const notesField = screen.getByPlaceholderText(/focus on the test plan/i);
    await userEvent.type(notesField, "check the DB migration");
    await userEvent.click(screen.getByText("Re-review"));

    await waitFor(() => {
      expect(mockApi.reReviewPlan).toHaveBeenCalledWith(RUN_ID, "check the DB migration");
    });

    await userEvent.click(screen.getByText("Revise Plan"));
    await userEvent.click(screen.getByText("Revise"));

    await waitFor(() => {
      expect(mockApi.revisePlan).toHaveBeenCalledWith(RUN_ID, undefined);
    });
  });
});
