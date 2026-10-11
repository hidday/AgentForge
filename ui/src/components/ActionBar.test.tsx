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

const RUN_ID = "run-1";

describe("ActionBar", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("renders null (no action bar) for a state with no applicable actions", () => {
    const { container } = render(
      <ActionBar runId={RUN_ID} state="Done" onAction={vi.fn()} />,
    );
    expect(container.firstChild).toBeNull();
  });

  describe("AwaitingPlanApproval state", () => {
    it("shows Approve Plan, Reject Plan, Re-review Plan and Revise Plan buttons", () => {
      render(<ActionBar runId={RUN_ID} state="AwaitingPlanApproval" onAction={vi.fn()} />);
      expect(screen.getByRole("button", { name: /approve plan/i })).toBeDefined();
      expect(screen.getByRole("button", { name: /reject plan/i })).toBeDefined();
      expect(screen.getByRole("button", { name: /re-review plan/i })).toBeDefined();
      expect(screen.getByRole("button", { name: /revise plan/i })).toBeDefined();
    });

    it("shows Answer Optional Questions button only when hasOptionalQuestions is true", () => {
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

    it("clicking Answer Optional Questions calls onScrollToQuestions", async () => {
      const onScrollToQuestions = vi.fn();
      render(
        <ActionBar
          runId={RUN_ID}
          state="AwaitingPlanApproval"
          onAction={vi.fn()}
          hasOptionalQuestions={true}
          onScrollToQuestions={onScrollToQuestions}
        />,
      );
      await userEvent.click(screen.getByRole("button", { name: /answer optional questions/i }));
      expect(onScrollToQuestions).toHaveBeenCalledOnce();
    });

    it("clicking Approve Plan opens a confirm dialog, and confirming calls api.approvePlan with the note", async () => {
      mockApi.approvePlan.mockResolvedValue({});
      const onAction = vi.fn();
      render(<ActionBar runId={RUN_ID} state="AwaitingPlanApproval" onAction={onAction} />);

      await userEvent.click(screen.getByRole("button", { name: /approve plan/i }));

      expect(screen.getByText("Approve & Start")).toBeDefined();
      const textarea = screen.getByPlaceholderText(/extra context, edge cases/i);
      await userEvent.type(textarea, "watch the migration");

      await userEvent.click(screen.getByRole("button", { name: "Approve & Start" }));

      await waitFor(() => {
        expect(mockApi.approvePlan).toHaveBeenCalledWith(RUN_ID, "watch the migration");
        expect(onAction).toHaveBeenCalledOnce();
      });
    });

    it("clicking Reject Plan opens the custom reject dialog with iterate/fresh mode toggle", async () => {
      mockApi.rejectPlan.mockResolvedValue({});
      const onAction = vi.fn();
      render(<ActionBar runId={RUN_ID} state="AwaitingPlanApproval" onAction={onAction} />);

      await userEvent.click(screen.getByRole("button", { name: /^reject plan$/i }));

      expect(screen.getByText("Revise plan")).toBeDefined();
      expect(screen.getByText("Start fresh")).toBeDefined();

      const feedback = screen.getByPlaceholderText(/describe what should change/i);
      await userEvent.type(feedback, "needs more detail");

      await userEvent.click(screen.getByText("Start fresh"));

      const confirmButtons = screen.getAllByRole("button", { name: /reject plan/i });
      // the dialog's submit button is the last "Reject Plan" labelled button
      await userEvent.click(confirmButtons[confirmButtons.length - 1]);

      await waitFor(() => {
        expect(mockApi.rejectPlan).toHaveBeenCalledWith(RUN_ID, "needs more detail", "fresh");
        expect(onAction).toHaveBeenCalledOnce();
      });
    });

    it("reject dialog defaults to iterate mode and passes undefined context when left blank", async () => {
      mockApi.rejectPlan.mockResolvedValue({});
      render(<ActionBar runId={RUN_ID} state="AwaitingPlanApproval" onAction={vi.fn()} />);

      await userEvent.click(screen.getByRole("button", { name: /^reject plan$/i }));
      const confirmButtons = screen.getAllByRole("button", { name: /reject plan/i });
      await userEvent.click(confirmButtons[confirmButtons.length - 1]);

      await waitFor(() => {
        expect(mockApi.rejectPlan).toHaveBeenCalledWith(RUN_ID, undefined, "iterate");
      });
    });

    it("cancelling the reject dialog clears the feedback text and closes it", async () => {
      render(<ActionBar runId={RUN_ID} state="AwaitingPlanApproval" onAction={vi.fn()} />);

      await userEvent.click(screen.getByRole("button", { name: /^reject plan$/i }));
      const feedback = screen.getByPlaceholderText(/describe what should change/i) as HTMLTextAreaElement;
      await userEvent.type(feedback, "some text");

      await userEvent.click(screen.getByRole("button", { name: /^cancel$/i }));

      expect(screen.queryByPlaceholderText(/describe what should change/i)).toBeNull();

      // Reopen to confirm the text was reset
      await userEvent.click(screen.getByRole("button", { name: /^reject plan$/i }));
      const reopenedFeedback = screen.getByPlaceholderText(
        /describe what should change/i,
      ) as HTMLTextAreaElement;
      expect(reopenedFeedback.value).toBe("");
    });

    it("clicking Re-review Plan opens a confirm dialog and calls api.reReviewPlan", async () => {
      mockApi.reReviewPlan.mockResolvedValue({});
      const onAction = vi.fn();
      render(<ActionBar runId={RUN_ID} state="AwaitingPlanApproval" onAction={onAction} />);

      await userEvent.click(screen.getByRole("button", { name: /re-review plan/i }));
      expect(screen.getByRole("heading", { name: "Re-review Plan" })).toBeDefined();

      await userEvent.click(screen.getByRole("button", { name: "Re-review" }));

      await waitFor(() => {
        expect(mockApi.reReviewPlan).toHaveBeenCalledWith(RUN_ID, undefined);
        expect(onAction).toHaveBeenCalledOnce();
      });
    });

    it("clicking Revise Plan opens a confirm dialog and calls api.revisePlan", async () => {
      mockApi.revisePlan.mockResolvedValue({});
      const onAction = vi.fn();
      render(<ActionBar runId={RUN_ID} state="AwaitingPlanApproval" onAction={onAction} />);

      await userEvent.click(screen.getByRole("button", { name: /revise plan/i }));
      const textarea = screen.getByPlaceholderText(/tighten the rollout step/i);
      await userEvent.type(textarea, "focus on tests");
      await userEvent.click(screen.getByRole("button", { name: "Revise" }));

      await waitFor(() => {
        expect(mockApi.revisePlan).toHaveBeenCalledWith(RUN_ID, "focus on tests");
        expect(onAction).toHaveBeenCalledOnce();
      });
    });

    it("cancelling the confirm dialog does not call the API", async () => {
      const onAction = vi.fn();
      render(<ActionBar runId={RUN_ID} state="AwaitingPlanApproval" onAction={onAction} />);

      await userEvent.click(screen.getByRole("button", { name: /approve plan/i }));
      await userEvent.click(screen.getByRole("button", { name: /^cancel$/i }));

      expect(mockApi.approvePlan).not.toHaveBeenCalled();
      expect(onAction).not.toHaveBeenCalled();
    });
  });

  it("ReadyForHumanReview: shows Approve & Complete and calls api.approveReview on confirm", async () => {
    mockApi.approveReview.mockResolvedValue({});
    const onAction = vi.fn();
    render(<ActionBar runId={RUN_ID} state="ReadyForHumanReview" onAction={onAction} />);

    await userEvent.click(screen.getByRole("button", { name: /approve & complete/i }));
    await userEvent.click(screen.getByRole("button", { name: "Complete Run" }));

    await waitFor(() => {
      expect(mockApi.approveReview).toHaveBeenCalledWith(RUN_ID);
      expect(onAction).toHaveBeenCalledOnce();
    });
  });

  it("active-category state (e.g. Implementing): shows Pause and Retry Execution, calls pauseRun", async () => {
    mockApi.pauseRun.mockResolvedValue({});
    const onAction = vi.fn();
    render(<ActionBar runId={RUN_ID} state="Implementing" onAction={onAction} />);

    expect(screen.getByRole("button", { name: /^pause$/i })).toBeDefined();
    expect(screen.getByRole("button", { name: /retry execution/i })).toBeDefined();

    await userEvent.click(screen.getByRole("button", { name: /^pause$/i }));
    const pauseButtons = screen.getAllByRole("button", { name: "Pause" });
    await userEvent.click(pauseButtons[pauseButtons.length - 1]);

    await waitFor(() => {
      expect(mockApi.pauseRun).toHaveBeenCalledWith(RUN_ID);
      expect(onAction).toHaveBeenCalledOnce();
    });
  });

  it.each([["AIBlocked"], ["HumanClarificationNeeded"], ["Failed"]])(
    "%s state: shows Resume button and calls api.resumeRun",
    async (state) => {
      mockApi.resumeRun.mockResolvedValue({});
      const onAction = vi.fn();
      render(<ActionBar runId={RUN_ID} state={state} onAction={onAction} />);

      await userEvent.click(screen.getByRole("button", { name: /^resume$/i }));
      const resumeButtons = screen.getAllByRole("button", { name: "Resume" });
      await userEvent.click(resumeButtons[resumeButtons.length - 1]);

      await waitFor(() => {
        expect(mockApi.resumeRun).toHaveBeenCalledWith(RUN_ID);
        expect(onAction).toHaveBeenCalledOnce();
      });
    },
  );

  it("HumanClarificationNeeded: also shows Answer Questions button that calls onScrollToQuestions", async () => {
    const onScrollToQuestions = vi.fn();
    render(
      <ActionBar
        runId={RUN_ID}
        state="HumanClarificationNeeded"
        onAction={vi.fn()}
        onScrollToQuestions={onScrollToQuestions}
      />,
    );
    await userEvent.click(screen.getByRole("button", { name: /^answer questions$/i }));
    expect(onScrollToQuestions).toHaveBeenCalledOnce();
  });

  it("Todo state: shows 'Start Run' retry-labeled button and calls api.retryStage", async () => {
    mockApi.retryStage.mockResolvedValue({});
    const onAction = vi.fn();
    render(<ActionBar runId={RUN_ID} state="Todo" onAction={onAction} />);

    const startBtn = screen.getByRole("button", { name: /start run/i });
    expect(startBtn).toBeDefined();
    await userEvent.click(startBtn);
    await userEvent.click(screen.getByRole("button", { name: "Retry" }));

    await waitFor(() => {
      expect(mockApi.retryStage).toHaveBeenCalledWith(RUN_ID);
      expect(onAction).toHaveBeenCalledOnce();
    });
  });

  it("uses the state-specific retry label from RETRY_LABELS for the Planning state", () => {
    render(<ActionBar runId={RUN_ID} state="Planning" onAction={vi.fn()} />);
    expect(screen.getByRole("button", { name: /retry planning/i })).toBeDefined();
  });

  it("shows a loading state ('Working...') on the confirm dialog while the action promise is pending", async () => {
    let resolveFn!: () => void;
    mockApi.approveReview.mockReturnValue(
      new Promise<void>((res) => {
        resolveFn = res;
      }),
    );
    render(<ActionBar runId={RUN_ID} state="ReadyForHumanReview" onAction={vi.fn()} />);

    await userEvent.click(screen.getByRole("button", { name: /approve & complete/i }));
    await userEvent.click(screen.getByRole("button", { name: "Complete Run" }));

    expect(screen.getByText("Working...")).toBeDefined();

    resolveFn();
    await waitFor(() => {
      expect(screen.queryByText("Working...")).toBeNull();
    });
  });

  it("swallows action errors (dialog closes without throwing) when the API call rejects", async () => {
    mockApi.approveReview.mockRejectedValue(new Error("network error"));
    const onAction = vi.fn();
    render(<ActionBar runId={RUN_ID} state="ReadyForHumanReview" onAction={onAction} />);

    await userEvent.click(screen.getByRole("button", { name: /approve & complete/i }));
    await userEvent.click(screen.getByRole("button", { name: "Complete Run" }));

    await waitFor(() => {
      expect(screen.queryByText("Complete Run")).toBeNull();
    });
    // onAction is only called on success
    expect(onAction).not.toHaveBeenCalled();
  });
});
