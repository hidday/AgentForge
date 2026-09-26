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

const mockApi = api as unknown as Record<string, ReturnType<typeof vi.fn>>;

const RUN_ID = "run-1";

describe("ActionBar", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    for (const key of Object.keys(mockApi)) {
      mockApi[key].mockResolvedValue({ ok: true });
    }
  });

  it("renders nothing for a state with no available actions", () => {
    const { container } = render(
      <ActionBar runId={RUN_ID} state="Done" onAction={vi.fn()} />,
    );
    expect(container.firstChild).toBeNull();
  });

  it("shows Approve/Reject/Re-review/Revise buttons for AwaitingPlanApproval", () => {
    render(<ActionBar runId={RUN_ID} state="AwaitingPlanApproval" onAction={vi.fn()} />);
    expect(screen.getByRole("button", { name: /Approve Plan/i })).toBeDefined();
    expect(screen.getByRole("button", { name: /Reject Plan/i })).toBeDefined();
    expect(screen.getByRole("button", { name: /Re-review Plan/i })).toBeDefined();
    expect(screen.getByRole("button", { name: /Revise Plan/i })).toBeDefined();
  });

  it("shows the Answer Optional Questions button only when hasOptionalQuestions is true", () => {
    const onScrollToQuestions = vi.fn();
    const { rerender } = render(
      <ActionBar
        runId={RUN_ID}
        state="AwaitingPlanApproval"
        onAction={vi.fn()}
        onScrollToQuestions={onScrollToQuestions}
        hasOptionalQuestions={false}
      />,
    );
    expect(screen.queryByRole("button", { name: /Answer Optional Questions/i })).toBeNull();

    rerender(
      <ActionBar
        runId={RUN_ID}
        state="AwaitingPlanApproval"
        onAction={vi.fn()}
        onScrollToQuestions={onScrollToQuestions}
        hasOptionalQuestions={true}
      />,
    );
    expect(screen.getByRole("button", { name: /Answer Optional Questions/i })).toBeDefined();
  });

  it("approves the plan through the confirm dialog and calls onAction", async () => {
    const onAction = vi.fn();
    render(<ActionBar runId={RUN_ID} state="AwaitingPlanApproval" onAction={onAction} />);

    await userEvent.click(screen.getByRole("button", { name: /^Approve Plan$/i }));
    expect(screen.getByText("This will approve the current plan and start implementation. The AI agent will begin coding.")).toBeDefined();

    await userEvent.click(screen.getByRole("button", { name: /Approve & Start/i }));

    await waitFor(() => {
      expect(mockApi.approvePlan).toHaveBeenCalledWith(RUN_ID, undefined);
      expect(onAction).toHaveBeenCalled();
    });
  });

  it("passes trimmed notes text to approvePlan", async () => {
    render(<ActionBar runId={RUN_ID} state="AwaitingPlanApproval" onAction={vi.fn()} />);

    await userEvent.click(screen.getByRole("button", { name: /^Approve Plan$/i }));
    const textarea = screen.getByPlaceholderText(/extra context, edge cases/i);
    await userEvent.type(textarea, "  watch the cache  ");
    await userEvent.click(screen.getByRole("button", { name: /Approve & Start/i }));

    await waitFor(() => {
      expect(mockApi.approvePlan).toHaveBeenCalledWith(RUN_ID, "watch the cache");
    });
  });

  it("does not call the API when the confirm dialog is cancelled", async () => {
    render(<ActionBar runId={RUN_ID} state="AwaitingPlanApproval" onAction={vi.fn()} />);

    await userEvent.click(screen.getByRole("button", { name: /^Approve Plan$/i }));
    await userEvent.click(screen.getByRole("button", { name: /^Cancel$/i }));

    expect(mockApi.approvePlan).not.toHaveBeenCalled();
    expect(screen.queryByText(/This will approve the current plan/i)).toBeNull();
  });

  it("does not call onAction when the confirmed action rejects", async () => {
    mockApi.approvePlan.mockRejectedValue(new Error("network error"));
    const onAction = vi.fn();
    render(<ActionBar runId={RUN_ID} state="AwaitingPlanApproval" onAction={onAction} />);

    await userEvent.click(screen.getByRole("button", { name: /^Approve Plan$/i }));
    await userEvent.click(screen.getByRole("button", { name: /Approve & Start/i }));

    await waitFor(() => {
      expect(mockApi.approvePlan).toHaveBeenCalled();
    });
    expect(onAction).not.toHaveBeenCalled();
    expect(screen.queryByText(/This will approve the current plan/i)).toBeNull();
  });

  it("opens the reject dialog, submits feedback in 'fresh' mode, and calls rejectPlan", async () => {
    const onAction = vi.fn();
    render(<ActionBar runId={RUN_ID} state="AwaitingPlanApproval" onAction={onAction} />);

    await userEvent.click(screen.getByRole("button", { name: /^Reject Plan$/i }));
    expect(
      screen.getByText("This will reject the current plan and send it back for re-planning."),
    ).toBeDefined();

    await userEvent.click(screen.getByText("Start fresh"));
    const textarea = screen.getByPlaceholderText(/describe what should change/i);
    await userEvent.type(textarea, "please simplify");

    // Two "Reject Plan" buttons now exist (the trigger and the confirm); pick
    // the submit button inside the dialog by role name plus disabled state check.
    const rejectButtons = screen.getAllByRole("button", { name: /^Reject Plan$/i });
    await userEvent.click(rejectButtons[rejectButtons.length - 1]);

    await waitFor(() => {
      expect(mockApi.rejectPlan).toHaveBeenCalledWith(RUN_ID, "please simplify", "fresh");
      expect(onAction).toHaveBeenCalled();
    });
  });

  it("defaults to 'iterate' mode and passes undefined context when feedback is empty", async () => {
    render(<ActionBar runId={RUN_ID} state="AwaitingPlanApproval" onAction={vi.fn()} />);

    await userEvent.click(screen.getByRole("button", { name: /^Reject Plan$/i }));
    const rejectButtons = screen.getAllByRole("button", { name: /^Reject Plan$/i });
    await userEvent.click(rejectButtons[rejectButtons.length - 1]);

    await waitFor(() => {
      expect(mockApi.rejectPlan).toHaveBeenCalledWith(RUN_ID, undefined, "iterate");
    });
  });

  it("closes the reject dialog on cancel without calling the API", async () => {
    render(<ActionBar runId={RUN_ID} state="AwaitingPlanApproval" onAction={vi.fn()} />);

    await userEvent.click(screen.getByRole("button", { name: /^Reject Plan$/i }));
    await userEvent.click(screen.getByRole("button", { name: /^Cancel$/i }));

    expect(mockApi.rejectPlan).not.toHaveBeenCalled();
    expect(
      screen.queryByText("This will reject the current plan and send it back for re-planning."),
    ).toBeNull();
  });

  it("calls reReviewPlan with entered notes", async () => {
    render(<ActionBar runId={RUN_ID} state="AwaitingPlanApproval" onAction={vi.fn()} />);

    await userEvent.click(screen.getByRole("button", { name: /Re-review Plan/i }));
    const textarea = screen.getByPlaceholderText(/focus on the test plan/i);
    await userEvent.type(textarea, "check the rollback step");
    await userEvent.click(screen.getByRole("button", { name: /^Re-review$/i }));

    await waitFor(() => {
      expect(mockApi.reReviewPlan).toHaveBeenCalledWith(RUN_ID, "check the rollback step");
    });
  });

  it("calls revisePlan when the Revise dialog is confirmed", async () => {
    render(<ActionBar runId={RUN_ID} state="AwaitingPlanApproval" onAction={vi.fn()} />);

    await userEvent.click(screen.getByRole("button", { name: /^Revise Plan$/i }));
    await userEvent.click(screen.getByRole("button", { name: /^Revise$/i }));

    await waitFor(() => {
      expect(mockApi.revisePlan).toHaveBeenCalledWith(RUN_ID, undefined);
    });
  });

  it("shows Approve & Complete for ReadyForHumanReview and calls approveReview", async () => {
    const onAction = vi.fn();
    render(<ActionBar runId={RUN_ID} state="ReadyForHumanReview" onAction={onAction} />);

    await userEvent.click(screen.getByRole("button", { name: /Approve & Complete/i }));
    await userEvent.click(screen.getByRole("button", { name: /Complete Run/i }));

    await waitFor(() => {
      expect(mockApi.approveReview).toHaveBeenCalledWith(RUN_ID);
      expect(onAction).toHaveBeenCalled();
    });
  });

  it("shows Pause for an active-category state and calls pauseRun", async () => {
    render(<ActionBar runId={RUN_ID} state="Implementing" onAction={vi.fn()} />);

    await userEvent.click(screen.getByRole("button", { name: /^Pause$/i }));
    const pauseButtons = screen.getAllByRole("button", { name: /^Pause$/i });
    await userEvent.click(pauseButtons[pauseButtons.length - 1]);

    await waitFor(() => {
      expect(mockApi.pauseRun).toHaveBeenCalledWith(RUN_ID);
    });
  });

  it("shows Resume and Answer Questions for HumanClarificationNeeded", async () => {
    const onScrollToQuestions = vi.fn();
    render(
      <ActionBar
        runId={RUN_ID}
        state="HumanClarificationNeeded"
        onAction={vi.fn()}
        onScrollToQuestions={onScrollToQuestions}
      />,
    );

    await userEvent.click(screen.getByRole("button", { name: /Answer Questions/i }));
    expect(onScrollToQuestions).toHaveBeenCalled();

    const resumeButtons = screen.getAllByRole("button", { name: /Resume/i });
    await userEvent.click(resumeButtons[0]);
    const confirmResume = screen.getAllByRole("button", { name: /Resume/i });
    await userEvent.click(confirmResume[confirmResume.length - 1]);

    await waitFor(() => {
      expect(mockApi.resumeRun).toHaveBeenCalledWith(RUN_ID);
    });
  });

  it("shows Resume for AIBlocked and Failed states", () => {
    const { rerender } = render(
      <ActionBar runId={RUN_ID} state="AIBlocked" onAction={vi.fn()} />,
    );
    expect(screen.getByRole("button", { name: /Resume/i })).toBeDefined();

    rerender(<ActionBar runId={RUN_ID} state="Failed" onAction={vi.fn()} />);
    expect(screen.getByRole("button", { name: /Resume/i })).toBeDefined();
  });

  it("shows a retry button with the correct label for a retryable state and calls retryStage", async () => {
    render(<ActionBar runId={RUN_ID} state="Planning" onAction={vi.fn()} />);

    const retryBtn = screen.getByRole("button", { name: /Retry Planning/i });
    await userEvent.click(retryBtn);
    await userEvent.click(screen.getByRole("button", { name: /^Retry$/i }));

    await waitFor(() => {
      expect(mockApi.retryStage).toHaveBeenCalledWith(RUN_ID);
    });
  });

  it("uses the generic 'Start Run' label for the Todo retry state", () => {
    render(<ActionBar runId={RUN_ID} state="Todo" onAction={vi.fn()} />);
    expect(screen.getByRole("button", { name: /Start Run/i })).toBeDefined();
  });
});
