import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

// Mock the api module before importing the component under test
vi.mock("@/api/client.ts", () => ({
  api: {
    approvePlan: vi.fn(),
    rejectPlan: vi.fn(),
    approveReview: vi.fn(),
    pauseRun: vi.fn(),
    resumeRun: vi.fn(),
    retryStage: vi.fn(),
    reReviewPlan: vi.fn(),
    revisePlan: vi.fn(),
  },
}));

import { ActionBar } from "./ActionBar.tsx";
import { api } from "@/api/client.ts";

const mockApi = api as unknown as {
  approvePlan: ReturnType<typeof vi.fn>;
  rejectPlan: ReturnType<typeof vi.fn>;
  approveReview: ReturnType<typeof vi.fn>;
  pauseRun: ReturnType<typeof vi.fn>;
  resumeRun: ReturnType<typeof vi.fn>;
  retryStage: ReturnType<typeof vi.fn>;
  reReviewPlan: ReturnType<typeof vi.fn>;
  revisePlan: ReturnType<typeof vi.fn>;
};

const RUN_ID = "run-123";

describe("ActionBar", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("renders nothing when the state has no applicable actions", () => {
    const { container } = render(
      <ActionBar runId={RUN_ID} state="Done" onAction={vi.fn()} />,
    );
    expect(container.firstChild).toBeNull();
  });

  describe("AwaitingPlanApproval", () => {
    it("shows Approve Plan, Reject Plan, Re-review Plan and Revise Plan buttons", () => {
      render(<ActionBar runId={RUN_ID} state="AwaitingPlanApproval" onAction={vi.fn()} />);
      expect(screen.getByRole("button", { name: /approve plan/i })).toBeDefined();
      expect(screen.getByRole("button", { name: /reject plan/i })).toBeDefined();
      expect(screen.getByRole("button", { name: /re-review plan/i })).toBeDefined();
      expect(screen.getByRole("button", { name: /revise plan/i })).toBeDefined();
    });

    it("does not show the optional-questions button when hasOptionalQuestions is false", () => {
      render(<ActionBar runId={RUN_ID} state="AwaitingPlanApproval" onAction={vi.fn()} />);
      expect(screen.queryByRole("button", { name: /answer optional questions/i })).toBeNull();
    });

    it("shows the optional-questions button and calls onScrollToQuestions when clicked", async () => {
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
      const btn = screen.getByRole("button", { name: /answer optional questions/i });
      await userEvent.click(btn);
      expect(onScrollToQuestions).toHaveBeenCalledOnce();
    });

    it("approves the plan with a trimmed note and calls onAction on success", async () => {
      mockApi.approvePlan.mockResolvedValue({});
      const onAction = vi.fn();
      render(<ActionBar runId={RUN_ID} state="AwaitingPlanApproval" onAction={onAction} />);

      await userEvent.click(screen.getByRole("button", { name: /approve plan/i }));
      expect(screen.getByText(/start implementation/i)).toBeDefined();

      const textarea = screen.getByRole("textbox") as HTMLTextAreaElement;
      await userEvent.type(textarea, "  watch the gotchas  ");
      await userEvent.click(screen.getByRole("button", { name: /approve & start/i }));

      await waitFor(() => {
        expect(mockApi.approvePlan).toHaveBeenCalledWith(RUN_ID, "watch the gotchas");
      });
      await waitFor(() => {
        expect(onAction).toHaveBeenCalledOnce();
      });
      // dialog should be closed afterwards
      expect(screen.queryByRole("textbox")).toBeNull();
    });

    it("approves the plan with undefined note when no notes are entered", async () => {
      mockApi.approvePlan.mockResolvedValue({});
      render(<ActionBar runId={RUN_ID} state="AwaitingPlanApproval" onAction={vi.fn()} />);

      await userEvent.click(screen.getByRole("button", { name: /approve plan/i }));
      await userEvent.click(screen.getByRole("button", { name: /approve & start/i }));

      await waitFor(() => {
        expect(mockApi.approvePlan).toHaveBeenCalledWith(RUN_ID, undefined);
      });
    });

    it("cancels the Approve Plan dialog without calling the API", async () => {
      render(<ActionBar runId={RUN_ID} state="AwaitingPlanApproval" onAction={vi.fn()} />);
      await userEvent.click(screen.getByRole("button", { name: /approve plan/i }));
      await userEvent.click(screen.getByRole("button", { name: /cancel/i }));
      expect(mockApi.approvePlan).not.toHaveBeenCalled();
      expect(screen.queryByRole("textbox")).toBeNull();
    });

    it("shows a loading indicator while approving and closes the dialog once resolved", async () => {
      let resolveFn!: (v: unknown) => void;
      mockApi.approvePlan.mockReturnValue(
        new Promise((res) => {
          resolveFn = res;
        }),
      );
      const onAction = vi.fn();
      render(<ActionBar runId={RUN_ID} state="AwaitingPlanApproval" onAction={onAction} />);

      await userEvent.click(screen.getByRole("button", { name: /approve plan/i }));
      await userEvent.click(screen.getByRole("button", { name: /approve & start/i }));

      expect(screen.getByText(/working/i)).toBeDefined();

      resolveFn({});

      await waitFor(() => {
        expect(screen.queryByText(/working/i)).toBeNull();
      });
      expect(onAction).toHaveBeenCalledOnce();
    });

    it("does not call onAction and still closes the dialog when approvePlan rejects", async () => {
      mockApi.approvePlan.mockRejectedValue(new Error("boom"));
      const onAction = vi.fn();
      render(<ActionBar runId={RUN_ID} state="AwaitingPlanApproval" onAction={onAction} />);

      await userEvent.click(screen.getByRole("button", { name: /approve plan/i }));
      await userEvent.click(screen.getByRole("button", { name: /approve & start/i }));

      await waitFor(() => {
        expect(screen.queryByRole("textbox")).toBeNull();
      });
      expect(onAction).not.toHaveBeenCalled();
    });

    it("opens the custom Reject Plan dialog, switches modes, and rejects with feedback", async () => {
      mockApi.rejectPlan.mockResolvedValue({});
      const onAction = vi.fn();
      render(<ActionBar runId={RUN_ID} state="AwaitingPlanApproval" onAction={onAction} />);

      await userEvent.click(screen.getByRole("button", { name: /^reject plan$/i }));
      expect(screen.getByText(/this will reject the current plan/i)).toBeDefined();

      await userEvent.click(screen.getByRole("button", { name: /start fresh/i }));
      const feedback = screen.getByPlaceholderText(/describe what should change/i);
      await userEvent.type(feedback, "  needs more tests  ");

      const confirmButtons = screen.getAllByRole("button", { name: /^reject plan$/i });
      // index 0 = toolbar trigger button, last = dialog confirm button
      await userEvent.click(confirmButtons[confirmButtons.length - 1]);

      await waitFor(() => {
        expect(mockApi.rejectPlan).toHaveBeenCalledWith(RUN_ID, "needs more tests", "fresh");
      });
      await waitFor(() => {
        expect(onAction).toHaveBeenCalledOnce();
      });
      expect(screen.queryByPlaceholderText(/describe what should change/i)).toBeNull();
    });

    it("rejects the plan with undefined note and default 'iterate' mode when nothing is typed", async () => {
      mockApi.rejectPlan.mockResolvedValue({});
      render(<ActionBar runId={RUN_ID} state="AwaitingPlanApproval" onAction={vi.fn()} />);

      await userEvent.click(screen.getByRole("button", { name: /^reject plan$/i }));
      const confirmButtons = screen.getAllByRole("button", { name: /^reject plan$/i });
      await userEvent.click(confirmButtons[confirmButtons.length - 1]);

      await waitFor(() => {
        expect(mockApi.rejectPlan).toHaveBeenCalledWith(RUN_ID, undefined, "iterate");
      });
    });

    it("cancels the Reject Plan dialog via the Cancel button and resets its fields", async () => {
      render(<ActionBar runId={RUN_ID} state="AwaitingPlanApproval" onAction={vi.fn()} />);

      await userEvent.click(screen.getByRole("button", { name: /^reject plan$/i }));
      await userEvent.click(screen.getByRole("button", { name: /start fresh/i }));
      const feedback = screen.getByPlaceholderText(/describe what should change/i);
      await userEvent.type(feedback, "abandoned feedback");

      await userEvent.click(screen.getByRole("button", { name: /cancel/i }));
      expect(mockApi.rejectPlan).not.toHaveBeenCalled();
      expect(screen.queryByPlaceholderText(/describe what should change/i)).toBeNull();

      // reopening should show a reset (empty) textarea, confirming state was cleared
      await userEvent.click(screen.getByRole("button", { name: /^reject plan$/i }));
      const reopenedFeedback = screen.getByPlaceholderText(
        /describe what should change/i,
      ) as HTMLTextAreaElement;
      expect(reopenedFeedback.value).toBe("");
    });

    it("cancels the Reject Plan dialog by clicking the backdrop", async () => {
      const { container } = render(
        <ActionBar runId={RUN_ID} state="AwaitingPlanApproval" onAction={vi.fn()} />,
      );
      await userEvent.click(screen.getByRole("button", { name: /^reject plan$/i }));
      const backdrop = container.querySelector(".fixed.inset-0.z-50 .absolute.inset-0");
      expect(backdrop).not.toBeNull();
      fireEvent.click(backdrop as Element);
      expect(screen.queryByPlaceholderText(/describe what should change/i)).toBeNull();
    });

    it("does not crash and still resets the dialog when rejectPlan rejects", async () => {
      mockApi.rejectPlan.mockRejectedValue(new Error("server error"));
      const onAction = vi.fn();
      render(<ActionBar runId={RUN_ID} state="AwaitingPlanApproval" onAction={onAction} />);

      await userEvent.click(screen.getByRole("button", { name: /^reject plan$/i }));
      const confirmButtons = screen.getAllByRole("button", { name: /^reject plan$/i });
      await userEvent.click(confirmButtons[confirmButtons.length - 1]);

      await waitFor(() => {
        expect(screen.queryByPlaceholderText(/describe what should change/i)).toBeNull();
      });
      expect(onAction).not.toHaveBeenCalled();
    });

    it("opens the Re-review Plan dialog and calls api.reReviewPlan with the note", async () => {
      mockApi.reReviewPlan.mockResolvedValue({});
      const onAction = vi.fn();
      render(<ActionBar runId={RUN_ID} state="AwaitingPlanApproval" onAction={onAction} />);

      await userEvent.click(screen.getByRole("button", { name: /re-review plan/i }));
      expect(screen.getByText(/run the plan reviewer again/i)).toBeDefined();

      const textarea = screen.getByRole("textbox") as HTMLTextAreaElement;
      await userEvent.type(textarea, "focus on tests");
      await userEvent.click(screen.getByRole("button", { name: /^re-review$/i }));

      await waitFor(() => {
        expect(mockApi.reReviewPlan).toHaveBeenCalledWith(RUN_ID, "focus on tests");
      });
      expect(onAction).toHaveBeenCalledOnce();
    });

    it("opens the Revise Plan dialog and calls api.revisePlan with undefined note when empty", async () => {
      mockApi.revisePlan.mockResolvedValue({});
      const onAction = vi.fn();
      render(<ActionBar runId={RUN_ID} state="AwaitingPlanApproval" onAction={onAction} />);

      await userEvent.click(screen.getByRole("button", { name: /revise plan/i }));
      expect(screen.getByText(/produce a new plan version/i)).toBeDefined();
      await userEvent.click(screen.getByRole("button", { name: /^revise$/i }));

      await waitFor(() => {
        expect(mockApi.revisePlan).toHaveBeenCalledWith(RUN_ID, undefined);
      });
      expect(onAction).toHaveBeenCalledOnce();
    });
  });

  describe("ReadyForHumanReview", () => {
    it("shows Approve & Complete and calls api.approveReview without a notes field", async () => {
      mockApi.approveReview.mockResolvedValue({});
      const onAction = vi.fn();
      render(<ActionBar runId={RUN_ID} state="ReadyForHumanReview" onAction={onAction} />);

      await userEvent.click(screen.getByRole("button", { name: /approve & complete/i }));
      expect(screen.queryByRole("textbox")).toBeNull();

      await userEvent.click(screen.getByRole("button", { name: /complete run/i }));

      await waitFor(() => {
        expect(mockApi.approveReview).toHaveBeenCalledWith(RUN_ID);
      });
      expect(onAction).toHaveBeenCalledOnce();
    });
  });

  describe("active category (Pause)", () => {
    it("shows the Pause button for an active state and calls api.pauseRun on confirm", async () => {
      mockApi.pauseRun.mockResolvedValue({});
      const onAction = vi.fn();
      render(<ActionBar runId={RUN_ID} state="AIReview" onAction={onAction} />);

      const pauseButtons = screen.getAllByRole("button", { name: /^pause$/i });
      expect(pauseButtons.length).toBe(1);
      await userEvent.click(pauseButtons[0]);

      expect(screen.getByText(/this will pause the run/i)).toBeDefined();
      const confirmButtons = screen.getAllByRole("button", { name: /^pause$/i });
      expect(confirmButtons.length).toBe(2);
      await userEvent.click(confirmButtons[confirmButtons.length - 1]);

      await waitFor(() => {
        expect(mockApi.pauseRun).toHaveBeenCalledWith(RUN_ID);
      });
      expect(onAction).toHaveBeenCalledOnce();
    });
  });

  describe("Resume flow", () => {
    it.each(["AIBlocked", "HumanClarificationNeeded", "Failed"])(
      "shows the Resume button for state=%s and calls api.resumeRun on confirm",
      async (state) => {
        mockApi.resumeRun.mockResolvedValue({});
        const onAction = vi.fn();
        render(<ActionBar runId={RUN_ID} state={state} onAction={onAction} />);

        const resumeButtons = screen.getAllByRole("button", { name: /^resume$/i });
        await userEvent.click(resumeButtons[0]);
        expect(screen.getByText(/reset the run back to the start/i)).toBeDefined();

        const confirmButtons = screen.getAllByRole("button", { name: /^resume$/i });
        await userEvent.click(confirmButtons[confirmButtons.length - 1]);

        await waitFor(() => {
          expect(mockApi.resumeRun).toHaveBeenCalledWith(RUN_ID);
        });
        expect(onAction).toHaveBeenCalledOnce();
      },
    );

    it("shows the Answer Questions button in HumanClarificationNeeded and triggers onScrollToQuestions", async () => {
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

    it("does not show the Answer Questions button for AIBlocked", () => {
      render(<ActionBar runId={RUN_ID} state="AIBlocked" onAction={vi.fn()} />);
      expect(screen.queryByRole("button", { name: /^answer questions$/i })).toBeNull();
    });
  });

  describe("Retry flow", () => {
    it("uses the Todo-specific retry label 'Start Run' and calls api.retryStage", async () => {
      mockApi.retryStage.mockResolvedValue({});
      const onAction = vi.fn();
      render(<ActionBar runId={RUN_ID} state="Todo" onAction={onAction} />);

      const startBtn = screen.getByRole("button", { name: /^start run$/i });
      await userEvent.click(startBtn);
      expect(screen.getByText(/re-run the current stage \(Todo\)/i)).toBeDefined();

      await userEvent.click(screen.getByRole("button", { name: /^retry$/i }));

      await waitFor(() => {
        expect(mockApi.retryStage).toHaveBeenCalledWith(RUN_ID);
      });
      expect(onAction).toHaveBeenCalledOnce();
    });

    it("shows both Pause and Retry Execution for the Implementing state", async () => {
      mockApi.retryStage.mockResolvedValue({});
      render(<ActionBar runId={RUN_ID} state="Implementing" onAction={vi.fn()} />);

      expect(screen.getByRole("button", { name: /^pause$/i })).toBeDefined();
      const retryBtn = screen.getByRole("button", { name: /retry execution/i });
      await userEvent.click(retryBtn);
      await userEvent.click(screen.getByRole("button", { name: /^retry$/i }));

      await waitFor(() => {
        expect(mockApi.retryStage).toHaveBeenCalledWith(RUN_ID);
      });
    });

    it("uses the AIReview-specific retry label 'Retry Code Review'", () => {
      render(<ActionBar runId={RUN_ID} state="AIReview" onAction={vi.fn()} />);
      expect(screen.getByRole("button", { name: /retry code review/i })).toBeDefined();
    });
  });
});
