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
    Object.values(mockApi).forEach((fn) => fn.mockResolvedValue({ ok: true }));
  });

  it("renders nothing for a state with no applicable actions", () => {
    const { container } = render(
      <ActionBar runId={RUN_ID} state="SomeUnrecognizedState" onAction={vi.fn()} />,
    );
    expect(container.firstChild).toBeNull();
  });

  it("renders Approve Plan and Reject Plan for AwaitingPlanApproval, plus Re-review and Revise buttons", () => {
    render(<ActionBar runId={RUN_ID} state="AwaitingPlanApproval" onAction={vi.fn()} />);
    expect(screen.getByRole("button", { name: /approve plan/i })).toBeDefined();
    expect(screen.getByRole("button", { name: /reject plan/i })).toBeDefined();
    expect(screen.getByRole("button", { name: /re-review plan/i })).toBeDefined();
    expect(screen.getByRole("button", { name: /revise plan/i })).toBeDefined();
  });

  it("shows the Answer Optional Questions button only when hasOptionalQuestions is true", () => {
    const { rerender } = render(
      <ActionBar runId={RUN_ID} state="AwaitingPlanApproval" onAction={vi.fn()} />,
    );
    expect(screen.queryByRole("button", { name: /answer optional questions/i })).toBeNull();

    rerender(
      <ActionBar
        runId={RUN_ID}
        state="AwaitingPlanApproval"
        onAction={vi.fn()}
        hasOptionalQuestions={true}
      />,
    );
    expect(screen.getByRole("button", { name: /answer optional questions/i })).toBeDefined();
  });

  it("calls onScrollToQuestions when Answer Questions is clicked (HumanClarificationNeeded state)", async () => {
    const onScrollToQuestions = vi.fn();
    render(
      <ActionBar
        runId={RUN_ID}
        state="HumanClarificationNeeded"
        onAction={vi.fn()}
        onScrollToQuestions={onScrollToQuestions}
      />,
    );
    await userEvent.click(screen.getByRole("button", { name: /answer questions/i }));
    expect(onScrollToQuestions).toHaveBeenCalledOnce();
  });

  it("calls onScrollToQuestions when Answer Optional Questions is clicked", async () => {
    const onScrollToQuestions = vi.fn();
    render(
      <ActionBar
        runId={RUN_ID}
        state="AwaitingPlanApproval"
        onAction={vi.fn()}
        onScrollToQuestions={onScrollToQuestions}
        hasOptionalQuestions={true}
      />,
    );
    await userEvent.click(screen.getByRole("button", { name: /answer optional questions/i }));
    expect(onScrollToQuestions).toHaveBeenCalledOnce();
  });

  it("shows Approve & Complete for ReadyForHumanReview and calls api.approveReview on confirm", async () => {
    const onAction = vi.fn();
    render(<ActionBar runId={RUN_ID} state="ReadyForHumanReview" onAction={onAction} />);

    await userEvent.click(screen.getByRole("button", { name: /approve & complete/i }));
    await userEvent.click(screen.getByRole("button", { name: "Complete Run" }));

    await waitFor(() => {
      expect(mockApi.approveReview).toHaveBeenCalledWith(RUN_ID);
      expect(onAction).toHaveBeenCalledOnce();
    });
  });

  it("shows Pause for an active-category state and calls api.pauseRun on confirm", async () => {
    const onAction = vi.fn();
    render(<ActionBar runId={RUN_ID} state="Implementing" onAction={onAction} />);

    await userEvent.click(screen.getByRole("button", { name: /^pause$/i }));
    const pauseButtons = screen.getAllByRole("button", { name: "Pause" });
    await userEvent.click(pauseButtons[pauseButtons.length - 1]);

    await waitFor(() => {
      expect(mockApi.pauseRun).toHaveBeenCalledWith(RUN_ID);
      expect(onAction).toHaveBeenCalledOnce();
    });
  });

  it("shows Resume for AIBlocked and calls api.resumeRun on confirm", async () => {
    const onAction = vi.fn();
    render(<ActionBar runId={RUN_ID} state="AIBlocked" onAction={onAction} />);

    await userEvent.click(screen.getByRole("button", { name: /^resume$/i }));
    const resumeButtons = screen.getAllByRole("button", { name: "Resume" });
    await userEvent.click(resumeButtons[resumeButtons.length - 1]);

    await waitFor(() => {
      expect(mockApi.resumeRun).toHaveBeenCalledWith(RUN_ID);
      expect(onAction).toHaveBeenCalledOnce();
    });
  });

  it("shows Resume for HumanClarificationNeeded and for Failed", () => {
    const { rerender } = render(
      <ActionBar runId={RUN_ID} state="HumanClarificationNeeded" onAction={vi.fn()} />,
    );
    expect(screen.getByRole("button", { name: /^resume$/i })).toBeDefined();

    rerender(<ActionBar runId={RUN_ID} state="Failed" onAction={vi.fn()} />);
    expect(screen.getByRole("button", { name: /^resume$/i })).toBeDefined();
  });

  it("shows a retry action with the state-specific label and calls api.retryStage on confirm", async () => {
    const onAction = vi.fn();
    render(<ActionBar runId={RUN_ID} state="AIReview" onAction={onAction} />);

    const retryBtn = screen.getByRole("button", { name: /retry code review/i });
    await userEvent.click(retryBtn);
    await userEvent.click(screen.getByRole("button", { name: "Retry" }));

    await waitFor(() => {
      expect(mockApi.retryStage).toHaveBeenCalledWith(RUN_ID);
      expect(onAction).toHaveBeenCalledOnce();
    });
  });

  it("shows the generic 'Start Run' retry label for Todo state", () => {
    render(<ActionBar runId={RUN_ID} state="Todo" onAction={vi.fn()} />);
    expect(screen.getByRole("button", { name: /start run/i })).toBeDefined();
  });

  it("calls api.approvePlan with the trimmed note from the confirm dialog", async () => {
    const onAction = vi.fn();
    render(<ActionBar runId={RUN_ID} state="AwaitingPlanApproval" onAction={onAction} />);

    await userEvent.click(screen.getByRole("button", { name: /^approve plan$/i }));
    const textarea = screen.getByPlaceholderText(/extra context/i);
    await userEvent.type(textarea, "watch the migration");
    await userEvent.click(screen.getByRole("button", { name: "Approve & Start" }));

    await waitFor(() => {
      expect(mockApi.approvePlan).toHaveBeenCalledWith(RUN_ID, "watch the migration");
      expect(onAction).toHaveBeenCalledOnce();
    });
  });

  it("opens the re-review dialog and calls api.reReviewPlan on confirm", async () => {
    const onAction = vi.fn();
    render(<ActionBar runId={RUN_ID} state="AwaitingPlanApproval" onAction={onAction} />);

    await userEvent.click(screen.getByRole("button", { name: /re-review plan/i }));
    await userEvent.click(screen.getByRole("button", { name: "Re-review" }));

    await waitFor(() => {
      expect(mockApi.reReviewPlan).toHaveBeenCalledWith(RUN_ID, undefined);
      expect(onAction).toHaveBeenCalledOnce();
    });
  });

  it("opens the revise-plan dialog and calls api.revisePlan on confirm", async () => {
    const onAction = vi.fn();
    render(<ActionBar runId={RUN_ID} state="AwaitingPlanApproval" onAction={onAction} />);

    await userEvent.click(screen.getByRole("button", { name: /^revise plan$/i }));
    await userEvent.click(screen.getByRole("button", { name: "Revise" }));

    await waitFor(() => {
      expect(mockApi.revisePlan).toHaveBeenCalledWith(RUN_ID, undefined);
      expect(onAction).toHaveBeenCalledOnce();
    });
  });

  it("cancelling the confirm dialog clears it without calling the action", async () => {
    render(<ActionBar runId={RUN_ID} state="Implementing" onAction={vi.fn()} />);
    await userEvent.click(screen.getByRole("button", { name: /^pause$/i }));
    expect(screen.getByText("Pause Run")).toBeDefined();

    await userEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(screen.queryByText("Pause Run")).toBeNull();
    expect(mockApi.pauseRun).not.toHaveBeenCalled();
  });

  it("swallows action errors, still clears loading/dialog state", async () => {
    mockApi.pauseRun.mockRejectedValue(new Error("network error"));
    const onAction = vi.fn();
    render(<ActionBar runId={RUN_ID} state="Implementing" onAction={onAction} />);

    await userEvent.click(screen.getByRole("button", { name: /^pause$/i }));
    const pauseButtons = screen.getAllByRole("button", { name: "Pause" });
    await userEvent.click(pauseButtons[pauseButtons.length - 1]);

    await waitFor(() => {
      expect(screen.queryByText("Pause Run")).toBeNull();
    });
    expect(onAction).not.toHaveBeenCalled();
  });

  it("opens the Reject Plan dialog, toggles reject mode, and calls api.rejectPlan with feedback and mode", async () => {
    const onAction = vi.fn();
    render(<ActionBar runId={RUN_ID} state="AwaitingPlanApproval" onAction={onAction} />);

    await userEvent.click(screen.getByRole("button", { name: /^reject plan$/i }));
    expect(screen.getByText("This will reject the current plan and send it back for re-planning.")).toBeDefined();

    // Default mode is "iterate" — switch to "fresh" and back to "iterate"
    // to exercise both tab handlers.
    await userEvent.click(screen.getByText("Start fresh"));
    await userEvent.click(screen.getByText("Revise plan"));
    await userEvent.click(screen.getByText("Start fresh"));

    const textarea = screen.getByPlaceholderText(/describe what should change/i);
    await userEvent.type(textarea, "needs a different approach");

    const rejectButtons = screen.getAllByRole("button", { name: "Reject Plan" });
    await userEvent.click(rejectButtons[rejectButtons.length - 1]);

    await waitFor(() => {
      expect(mockApi.rejectPlan).toHaveBeenCalledWith(
        RUN_ID,
        "needs a different approach",
        "fresh",
      );
      expect(onAction).toHaveBeenCalledOnce();
    });
  });

  it("calls api.rejectPlan with undefined context and default 'iterate' mode when feedback is empty", async () => {
    render(<ActionBar runId={RUN_ID} state="AwaitingPlanApproval" onAction={vi.fn()} />);

    await userEvent.click(screen.getByRole("button", { name: /^reject plan$/i }));
    const rejectButtons = screen.getAllByRole("button", { name: "Reject Plan" });
    await userEvent.click(rejectButtons[rejectButtons.length - 1]);

    await waitFor(() => {
      expect(mockApi.rejectPlan).toHaveBeenCalledWith(RUN_ID, undefined, "iterate");
    });
  });

  it("cancels the reject dialog via the Cancel button without calling rejectPlan", async () => {
    render(<ActionBar runId={RUN_ID} state="AwaitingPlanApproval" onAction={vi.fn()} />);

    await userEvent.click(screen.getByRole("button", { name: /^reject plan$/i }));
    const textarea = screen.getByPlaceholderText(/describe what should change/i);
    await userEvent.type(textarea, "some feedback");

    const dialogCancelBtns = screen.getAllByRole("button", { name: "Cancel" });
    await userEvent.click(dialogCancelBtns[dialogCancelBtns.length - 1]);

    expect(screen.queryByText("This will reject the current plan and send it back for re-planning.")).toBeNull();
    expect(mockApi.rejectPlan).not.toHaveBeenCalled();
  });

  it("swallows rejectPlan errors and still resets the dialog", async () => {
    mockApi.rejectPlan.mockRejectedValue(new Error("boom"));
    render(<ActionBar runId={RUN_ID} state="AwaitingPlanApproval" onAction={vi.fn()} />);

    await userEvent.click(screen.getByRole("button", { name: /^reject plan$/i }));
    const rejectButtons = screen.getAllByRole("button", { name: "Reject Plan" });
    await userEvent.click(rejectButtons[rejectButtons.length - 1]);

    await waitFor(() => {
      expect(screen.queryByText("This will reject the current plan and send it back for re-planning.")).toBeNull();
    });
  });
});
