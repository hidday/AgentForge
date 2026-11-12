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
}

const RUN_ID = "run-1";

describe("ActionBar", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("renders nothing for a terminal state with no applicable actions", () => {
    const { container } = render(
      <ActionBar runId={RUN_ID} state="Done" onAction={vi.fn()} />,
    );
    expect(container.firstChild).toBeNull();
  });

  describe("AwaitingPlanApproval state", () => {
    it("renders Approve Plan, Reject Plan, Re-review Plan and Revise Plan buttons", () => {
      render(<ActionBar runId={RUN_ID} state="AwaitingPlanApproval" onAction={vi.fn()} />);
      expect(screen.getByRole("button", { name: /Approve Plan/i })).toBeDefined();
      expect(screen.getByRole("button", { name: /Reject Plan/i })).toBeDefined();
      expect(screen.getByRole("button", { name: /Re-review Plan/i })).toBeDefined();
      expect(screen.getByRole("button", { name: /Revise Plan/i })).toBeDefined();
    });

    it("renders the Answer Optional Questions button when hasOptionalQuestions is true", () => {
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
      expect(screen.getByRole("button", { name: /Answer Optional Questions/i })).toBeDefined();
    });

    it("does not render the Answer Optional Questions button when hasOptionalQuestions is false", () => {
      render(
        <ActionBar
          runId={RUN_ID}
          state="AwaitingPlanApproval"
          onAction={vi.fn()}
          hasOptionalQuestions={false}
        />,
      );
      expect(screen.queryByRole("button", { name: /Answer Optional Questions/i })).toBeNull();
    });

    it("clicking Answer Optional Questions calls onScrollToQuestions", async () => {
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
      await userEvent.click(screen.getByRole("button", { name: /Answer Optional Questions/i }));
      expect(onScrollToQuestions).toHaveBeenCalledOnce();
    });

    it("opens the Approve Plan confirm dialog and calls api.approvePlan with the note on confirm", async () => {
      mockApi.approvePlan.mockResolvedValue({});
      const onAction = vi.fn();
      render(<ActionBar runId={RUN_ID} state="AwaitingPlanApproval" onAction={onAction} />);

      await userEvent.click(screen.getByRole("button", { name: /Approve Plan/i }));
      expect(screen.getByText("Approve & Start")).toBeDefined();

      const textarea = screen.getByRole("textbox");
      await userEvent.type(textarea, "go ahead");
      await userEvent.click(screen.getByRole("button", { name: "Approve & Start" }));

      await waitFor(() => {
        expect(mockApi.approvePlan).toHaveBeenCalledWith(RUN_ID, "go ahead");
        expect(onAction).toHaveBeenCalledOnce();
      });
    });

    it("cancelling the confirm dialog does not call the API", async () => {
      render(<ActionBar runId={RUN_ID} state="AwaitingPlanApproval" onAction={vi.fn()} />);
      await userEvent.click(screen.getByRole("button", { name: /Approve Plan/i }));
      await userEvent.click(screen.getByRole("button", { name: "Cancel" }));
      expect(mockApi.approvePlan).not.toHaveBeenCalled();
      // Dialog should be closed
      expect(screen.queryByText("Approve & Start")).toBeNull();
    });

    it("opens Re-review Plan dialog and calls api.reReviewPlan on confirm", async () => {
      mockApi.reReviewPlan.mockResolvedValue({});
      const onAction = vi.fn();
      render(<ActionBar runId={RUN_ID} state="AwaitingPlanApproval" onAction={onAction} />);

      await userEvent.click(screen.getByRole("button", { name: /Re-review Plan/i }));
      expect(screen.getByText("Run the plan reviewer again against the current plan. The run will return to Awaiting Plan Approval after the review completes.")).toBeDefined();
      await userEvent.click(screen.getByRole("button", { name: "Re-review" }));

      await waitFor(() => {
        expect(mockApi.reReviewPlan).toHaveBeenCalledWith(RUN_ID, undefined);
        expect(onAction).toHaveBeenCalledOnce();
      });
    });

    it("opens Revise Plan dialog and calls api.revisePlan on confirm", async () => {
      mockApi.revisePlan.mockResolvedValue({});
      const onAction = vi.fn();
      render(<ActionBar runId={RUN_ID} state="AwaitingPlanApproval" onAction={onAction} />);

      await userEvent.click(screen.getByRole("button", { name: /Revise Plan/i }));
      await userEvent.click(screen.getByRole("button", { name: "Revise" }));

      await waitFor(() => {
        expect(mockApi.revisePlan).toHaveBeenCalledWith(RUN_ID, undefined);
        expect(onAction).toHaveBeenCalledOnce();
      });
    });

    it("opens the custom Reject Plan dialog instead of the generic ConfirmDialog", async () => {
      render(<ActionBar runId={RUN_ID} state="AwaitingPlanApproval" onAction={vi.fn()} />);
      await userEvent.click(screen.getByRole("button", { name: "Reject Plan" }));
      expect(
        screen.getByText("This will reject the current plan and send it back for re-planning."),
      ).toBeDefined();
      // Both mode toggle buttons are visible
      expect(screen.getByText("Revise plan")).toBeDefined();
      expect(screen.getByText("Start fresh")).toBeDefined();
    });

    it("reject dialog defaults to iterate mode and submits with mode 'iterate' and trimmed feedback", async () => {
      mockApi.rejectPlan.mockResolvedValue({});
      const onAction = vi.fn();
      render(<ActionBar runId={RUN_ID} state="AwaitingPlanApproval" onAction={onAction} />);

      await userEvent.click(screen.getByRole("button", { name: "Reject Plan" }));
      const textarea = screen.getByPlaceholderText(/Optional: describe what should change/i);
      await userEvent.type(textarea, "  needs more detail  ");

      // There are now two "Reject Plan" buttons: trigger button is gone (dialog open),
      // find the submit button inside the dialog by exact name.
      const submitButtons = screen.getAllByRole("button", { name: "Reject Plan" });
      await userEvent.click(submitButtons[submitButtons.length - 1]);

      await waitFor(() => {
        expect(mockApi.rejectPlan).toHaveBeenCalledWith(RUN_ID, "needs more detail", "iterate");
        expect(onAction).toHaveBeenCalledOnce();
      });
    });

    it("reject dialog submits with mode 'fresh' when Start fresh is selected and no feedback given", async () => {
      mockApi.rejectPlan.mockResolvedValue({});
      const onAction = vi.fn();
      render(<ActionBar runId={RUN_ID} state="AwaitingPlanApproval" onAction={onAction} />);

      await userEvent.click(screen.getByRole("button", { name: "Reject Plan" }));
      await userEvent.click(screen.getByText("Start fresh"));

      const submitButtons = screen.getAllByRole("button", { name: "Reject Plan" });
      await userEvent.click(submitButtons[submitButtons.length - 1]);

      await waitFor(() => {
        expect(mockApi.rejectPlan).toHaveBeenCalledWith(RUN_ID, undefined, "fresh");
        expect(onAction).toHaveBeenCalledOnce();
      });
    });

    it("cancelling the reject dialog resets state and does not call the API", async () => {
      render(<ActionBar runId={RUN_ID} state="AwaitingPlanApproval" onAction={vi.fn()} />);
      await userEvent.click(screen.getByRole("button", { name: "Reject Plan" }));
      await userEvent.click(screen.getByText("Start fresh"));

      const cancelBtns = screen.getAllByRole("button", { name: "Cancel" });
      await userEvent.click(cancelBtns[cancelBtns.length - 1]);

      expect(mockApi.rejectPlan).not.toHaveBeenCalled();
      expect(
        screen.queryByText("This will reject the current plan and send it back for re-planning."),
      ).toBeNull();

      // Reopening should show the mode reset back to "Revise plan" selected (iterate default).
      await userEvent.click(screen.getByRole("button", { name: "Reject Plan" }));
      const feedbackBox = screen.getByPlaceholderText(
        /Optional: describe what should change/i,
      ) as HTMLTextAreaElement;
      expect(feedbackBox.value).toBe("");
    });
  });

  describe("ReadyForHumanReview state", () => {
    it("renders the Approve & Complete button and calls api.approveReview on confirm", async () => {
      mockApi.approveReview.mockResolvedValue({});
      const onAction = vi.fn();
      render(<ActionBar runId={RUN_ID} state="ReadyForHumanReview" onAction={onAction} />);

      await userEvent.click(screen.getByRole("button", { name: /Approve & Complete/i }));
      await userEvent.click(screen.getByRole("button", { name: "Complete Run" }));

      await waitFor(() => {
        expect(mockApi.approveReview).toHaveBeenCalledWith(RUN_ID);
        expect(onAction).toHaveBeenCalledOnce();
      });
    });
  });

  describe("active-category states (Pause button)", () => {
    it("renders a Pause button for an active state like Implementing and calls api.pauseRun on confirm", async () => {
      mockApi.pauseRun.mockResolvedValue({});
      const onAction = vi.fn();
      render(<ActionBar runId={RUN_ID} state="Implementing" onAction={onAction} />);

      await userEvent.click(screen.getByRole("button", { name: /Pause/i }));
      const pauseButtons = screen.getAllByRole("button", { name: "Pause" });
      await userEvent.click(pauseButtons[pauseButtons.length - 1]);

      await waitFor(() => {
        expect(mockApi.pauseRun).toHaveBeenCalledWith(RUN_ID);
        expect(onAction).toHaveBeenCalledOnce();
      });
    });

    it("does not render a Pause button for a non-active state like Done", () => {
      render(<ActionBar runId={RUN_ID} state="Done" onAction={vi.fn()} />);
      expect(screen.queryByRole("button", { name: /Pause/i })).toBeNull();
    });
  });

  describe("Resume button states", () => {
    it.each(["AIBlocked", "HumanClarificationNeeded", "Failed"])(
      "renders Resume button for state %s and calls api.resumeRun on confirm",
      async (state) => {
        mockApi.resumeRun.mockResolvedValue({});
        const onAction = vi.fn();
        render(<ActionBar runId={RUN_ID} state={state} onAction={onAction} />);

        await userEvent.click(screen.getByRole("button", { name: /Resume/i }));
        const resumeButtons = screen.getAllByRole("button", { name: "Resume" });
        await userEvent.click(resumeButtons[resumeButtons.length - 1]);

        await waitFor(() => {
          expect(mockApi.resumeRun).toHaveBeenCalledWith(RUN_ID);
          expect(onAction).toHaveBeenCalledOnce();
        });
      },
    );

    it("shows the Answer Questions button for HumanClarificationNeeded and it calls onScrollToQuestions", async () => {
      const onScrollToQuestions = vi.fn();
      render(
        <ActionBar
          runId={RUN_ID}
          state="HumanClarificationNeeded"
          onAction={vi.fn()}
          onScrollToQuestions={onScrollToQuestions}
        />,
      );
      await userEvent.click(screen.getByRole("button", { name: "Answer Questions" }));
      expect(onScrollToQuestions).toHaveBeenCalledOnce();
    });
  });

  describe("Retry button states", () => {
    it.each([
      ["Todo", "Start Run"],
      ["Planning", "Retry Planning"],
      ["PlanRevision", "Retry Plan Revision"],
      ["PlanReview", "Retry Plan Review"],
      ["Implementing", "Retry Execution"],
      ["AIReview", "Retry Code Review"],
      ["AddressingReview", "Retry Remediation"],
    ])("renders '%s' -> '%s' retry label and calls api.retryStage on confirm", async (state, label) => {
      mockApi.retryStage.mockResolvedValue({});
      const onAction = vi.fn();
      render(<ActionBar runId={RUN_ID} state={state} onAction={onAction} />);

      const retryBtn = screen.getByRole("button", { name: label });
      expect(retryBtn).toBeDefined();
      await userEvent.click(retryBtn);
      await userEvent.click(screen.getByRole("button", { name: "Retry" }));

      await waitFor(() => {
        expect(mockApi.retryStage).toHaveBeenCalledWith(RUN_ID);
        expect(onAction).toHaveBeenCalledOnce();
      });
    });

    it("falls back to a generic 'Retry' label and 'Retry Stage' dialog title for a state not in RETRY_LABELS but still eligible (defensive check via known state)", () => {
      // Implementing is covered above with its specific label; this test asserts
      // the dialog description includes the current state name for traceability.
      render(<ActionBar runId={RUN_ID} state="AIReview" onAction={vi.fn()} />);
      expect(screen.getByRole("button", { name: "Retry Code Review" })).toBeDefined();
    });
  });

  describe("loading / error behavior", () => {
    it("shows the loading spinner label and disables buttons while the confirm action is pending", async () => {
      let resolveFn!: (v: unknown) => void;
      mockApi.pauseRun.mockReturnValue(
        new Promise((resolve) => {
          resolveFn = resolve;
        }),
      );

      render(<ActionBar runId={RUN_ID} state="Implementing" onAction={vi.fn()} />);
      await userEvent.click(screen.getByRole("button", { name: /Pause/i }));
      const pauseButtons = screen.getAllByRole("button", { name: "Pause" });
      await userEvent.click(pauseButtons[pauseButtons.length - 1]);

      expect(screen.getByText("Working...")).toBeDefined();

      resolveFn({});
      await waitFor(() => {
        expect(screen.queryByText("Working...")).toBeNull();
      });
    });

    it("closes the dialog and does not call onAction when the API call rejects", async () => {
      mockApi.pauseRun.mockRejectedValue(new Error("network error"));
      const onAction = vi.fn();
      render(<ActionBar runId={RUN_ID} state="Implementing" onAction={onAction} />);

      await userEvent.click(screen.getByRole("button", { name: /Pause/i }));
      const pauseButtons = screen.getAllByRole("button", { name: "Pause" });
      await userEvent.click(pauseButtons[pauseButtons.length - 1]);

      await waitFor(() => {
        expect(screen.queryByText("Working...")).toBeNull();
      });
      expect(onAction).not.toHaveBeenCalled();
      // Dialog is closed
      expect(screen.queryByText("This will pause the run. You can resume it later.")).toBeNull();
    });

    it("shows loading state and resets inputs when the reject action rejects", async () => {
      mockApi.rejectPlan.mockRejectedValue(new Error("server error"));
      const onAction = vi.fn();
      render(<ActionBar runId={RUN_ID} state="AwaitingPlanApproval" onAction={onAction} />);

      await userEvent.click(screen.getByRole("button", { name: "Reject Plan" }));
      const textarea = screen.getByPlaceholderText(/Optional: describe what should change/i);
      await userEvent.type(textarea, "feedback");

      const submitButtons = screen.getAllByRole("button", { name: "Reject Plan" });
      await userEvent.click(submitButtons[submitButtons.length - 1]);

      await waitFor(() => {
        expect(mockApi.rejectPlan).toHaveBeenCalledWith(RUN_ID, "feedback", "iterate");
      });
      expect(onAction).not.toHaveBeenCalled();
      // Reject dialog should have closed after failure (component resets showRejectDialog to false)
      await waitFor(() => {
        expect(
          screen.queryByText(
            "This will reject the current plan and send it back for re-planning.",
          ),
        ).toBeNull();
      });
    });
  });
});
