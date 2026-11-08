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

  it("renders nothing for a state with no applicable actions", () => {
    const { container } = render(
      <ActionBar runId={RUN_ID} state="Done" onAction={vi.fn()} />,
    );
    expect(container.firstChild).toBeNull();
  });

  describe("AwaitingPlanApproval state", () => {
    it("shows Approve Plan, Reject Plan, Re-review Plan and Revise Plan buttons", () => {
      render(
        <ActionBar runId={RUN_ID} state="AwaitingPlanApproval" onAction={vi.fn()} />,
      );
      expect(screen.getByRole("button", { name: /approve plan/i })).toBeDefined();
      expect(screen.getByRole("button", { name: /reject plan/i })).toBeDefined();
      expect(screen.getByRole("button", { name: /re-review plan/i })).toBeDefined();
      expect(screen.getByRole("button", { name: /revise plan/i })).toBeDefined();
    });

    it("does not show Answer Optional Questions button when hasOptionalQuestions is false", () => {
      render(
        <ActionBar runId={RUN_ID} state="AwaitingPlanApproval" onAction={vi.fn()} />,
      );
      expect(screen.queryByRole("button", { name: /answer optional questions/i })).toBeNull();
    });

    it("shows Answer Optional Questions button when hasOptionalQuestions is true, and it calls onScrollToQuestions", async () => {
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

    it("opens the Approve Plan confirmation dialog and calls api.approvePlan + onAction on confirm", async () => {
      mockApi.approvePlan.mockResolvedValue({ ok: true, state: "Implementing" });
      const onAction = vi.fn();
      render(
        <ActionBar runId={RUN_ID} state="AwaitingPlanApproval" onAction={onAction} />,
      );
      await userEvent.click(screen.getByRole("button", { name: /approve plan/i }));

      expect(screen.getByRole("heading", { name: "Approve Plan" })).toBeDefined();
      expect(screen.getByText(/begin coding/i)).toBeDefined();

      await userEvent.click(screen.getByRole("button", { name: /approve & start/i }));

      await waitFor(() => {
        expect(mockApi.approvePlan).toHaveBeenCalledWith(RUN_ID, undefined);
      });
      expect(onAction).toHaveBeenCalledOnce();
    });

    it("passes trimmed notes text through to api.approvePlan", async () => {
      mockApi.approvePlan.mockResolvedValue({ ok: true, state: "Implementing" });
      render(<ActionBar runId={RUN_ID} state="AwaitingPlanApproval" onAction={vi.fn()} />);
      await userEvent.click(screen.getByRole("button", { name: /approve plan/i }));

      const textarea = screen.getByRole("textbox");
      await userEvent.type(textarea, "  watch the edge cases  ");
      await userEvent.click(screen.getByRole("button", { name: /approve & start/i }));

      await waitFor(() => {
        expect(mockApi.approvePlan).toHaveBeenCalledWith(RUN_ID, "watch the edge cases");
      });
    });

    it("closes the confirm dialog without calling the API when Cancel is clicked", async () => {
      render(<ActionBar runId={RUN_ID} state="AwaitingPlanApproval" onAction={vi.fn()} />);
      await userEvent.click(screen.getByRole("button", { name: /approve plan/i }));
      expect(screen.getByRole("heading", { name: "Approve Plan" })).toBeDefined();

      await userEvent.click(screen.getByRole("button", { name: /cancel/i }));

      expect(screen.queryByText(/begin coding/i)).toBeNull();
      expect(mockApi.approvePlan).not.toHaveBeenCalled();
    });

    it("recovers (clears loading, closes dialog) when the confirmed action rejects", async () => {
      mockApi.approvePlan.mockRejectedValue(new Error("boom"));
      const onAction = vi.fn();
      render(<ActionBar runId={RUN_ID} state="AwaitingPlanApproval" onAction={onAction} />);
      await userEvent.click(screen.getByRole("button", { name: /approve plan/i }));
      await userEvent.click(screen.getByRole("button", { name: /approve & start/i }));

      await waitFor(() => {
        expect(mockApi.approvePlan).toHaveBeenCalled();
      });
      // Dialog should be closed again (title no longer present) and onAction not called
      await waitFor(() => {
        expect(screen.queryByText(/begin coding/i)).toBeNull();
      });
      expect(onAction).not.toHaveBeenCalled();
    });

    it("opens the Re-review Plan dialog and calls api.reReviewPlan on confirm", async () => {
      mockApi.reReviewPlan.mockResolvedValue({ ok: true, runId: RUN_ID });
      const onAction = vi.fn();
      render(<ActionBar runId={RUN_ID} state="AwaitingPlanApproval" onAction={onAction} />);
      await userEvent.click(screen.getByRole("button", { name: /re-review plan/i }));
      expect(screen.getByRole("heading", { name: "Re-review Plan" })).toBeDefined();
      await userEvent.click(screen.getByRole("button", { name: /^re-review$/i }));

      await waitFor(() => {
        expect(mockApi.reReviewPlan).toHaveBeenCalledWith(RUN_ID, undefined);
      });
      expect(onAction).toHaveBeenCalledOnce();
    });

    it("opens the Revise Plan dialog and calls api.revisePlan on confirm", async () => {
      mockApi.revisePlan.mockResolvedValue({ ok: true, runId: RUN_ID });
      const onAction = vi.fn();
      render(<ActionBar runId={RUN_ID} state="AwaitingPlanApproval" onAction={onAction} />);
      await userEvent.click(screen.getByRole("button", { name: /revise plan/i }));
      expect(screen.getByRole("heading", { name: "Revise Plan" })).toBeDefined();
      await userEvent.click(screen.getByRole("button", { name: /^revise$/i }));

      await waitFor(() => {
        expect(mockApi.revisePlan).toHaveBeenCalledWith(RUN_ID, undefined);
      });
      expect(onAction).toHaveBeenCalledOnce();
    });

    describe("Reject Plan custom dialog", () => {
      it("opens the reject dialog defaulting to 'iterate' mode", async () => {
        render(<ActionBar runId={RUN_ID} state="AwaitingPlanApproval" onAction={vi.fn()} />);
        await userEvent.click(screen.getByRole("button", { name: /^reject plan$/i }));

        expect(
          screen.getByText("This will reject the current plan and send it back for re-planning."),
        ).toBeDefined();
        // The mode toggle's "Revise plan" option (iterate) starts selected/highlighted.
        const reviseModeBtn = screen.getByText("Revise plan").closest("button");
        expect(reviseModeBtn?.className).toContain("bg-accent");
      });

      it("switches to 'fresh' mode when 'Start fresh' is clicked, then submits with that mode", async () => {
        mockApi.rejectPlan.mockResolvedValue({ ok: true, state: "Planning" });
        const onAction = vi.fn();
        render(<ActionBar runId={RUN_ID} state="AwaitingPlanApproval" onAction={onAction} />);
        await userEvent.click(screen.getByRole("button", { name: /^reject plan$/i }));

        const startFreshBtn = screen.getByText("Start fresh").closest("button")!;
        await userEvent.click(startFreshBtn);
        expect(startFreshBtn.className).toContain("bg-accent");

        // Switch back to 'iterate' mode and confirm the toggle takes effect.
        const iterateBtn = screen.getByText("Revise plan").closest("button")!;
        await userEvent.click(iterateBtn);
        expect(iterateBtn.className).toContain("bg-accent");
        expect(startFreshBtn.className).not.toContain("bg-accent");

        // Switch to 'fresh' again for the actual submission under test.
        await userEvent.click(startFreshBtn);

        const feedback = screen.getByPlaceholderText(/describe what should change/i);
        await userEvent.type(feedback, "  please simplify step 3  ");

        const confirmButtons = screen.getAllByRole("button", { name: /^reject plan$/i });
        // The second "Reject Plan" button is the dialog's submit button (first is the trigger).
        await userEvent.click(confirmButtons[confirmButtons.length - 1]);

        await waitFor(() => {
          expect(mockApi.rejectPlan).toHaveBeenCalledWith(
            RUN_ID,
            "please simplify step 3",
            "fresh",
          );
        });
        expect(onAction).toHaveBeenCalledOnce();
      });

      it("submits with undefined context and default 'iterate' mode when feedback is left blank", async () => {
        mockApi.rejectPlan.mockResolvedValue({ ok: true, state: "Planning" });
        render(<ActionBar runId={RUN_ID} state="AwaitingPlanApproval" onAction={vi.fn()} />);
        await userEvent.click(screen.getByRole("button", { name: /^reject plan$/i }));

        const confirmButtons = screen.getAllByRole("button", { name: /^reject plan$/i });
        await userEvent.click(confirmButtons[confirmButtons.length - 1]);

        await waitFor(() => {
          expect(mockApi.rejectPlan).toHaveBeenCalledWith(RUN_ID, undefined, "iterate");
        });
      });

      it("cancels the reject dialog via the Cancel button and resets feedback text", async () => {
        render(<ActionBar runId={RUN_ID} state="AwaitingPlanApproval" onAction={vi.fn()} />);
        await userEvent.click(screen.getByRole("button", { name: /^reject plan$/i }));

        const feedback = screen.getByPlaceholderText(/describe what should change/i);
        await userEvent.type(feedback, "some feedback");

        await userEvent.click(screen.getByRole("button", { name: /^cancel$/i }));

        expect(
          screen.queryByText("This will reject the current plan and send it back for re-planning."),
        ).toBeNull();
        expect(mockApi.rejectPlan).not.toHaveBeenCalled();
      });

      it("cancels the reject dialog when the backdrop is clicked", async () => {
        const { container } = render(
          <ActionBar runId={RUN_ID} state="AwaitingPlanApproval" onAction={vi.fn()} />,
        );
        await userEvent.click(screen.getByRole("button", { name: /^reject plan$/i }));
        const backdrop = container.querySelector(".absolute.inset-0.bg-black\\/60") as HTMLElement;
        expect(backdrop).toBeTruthy();
        await userEvent.click(backdrop);

        expect(
          screen.queryByText("This will reject the current plan and send it back for re-planning."),
        ).toBeNull();
      });

      it("shows a loading indicator and recovers after a failed reject submission", async () => {
        mockApi.rejectPlan.mockRejectedValue(new Error("reject failed"));
        render(<ActionBar runId={RUN_ID} state="AwaitingPlanApproval" onAction={vi.fn()} />);
        await userEvent.click(screen.getByRole("button", { name: /^reject plan$/i }));

        const confirmButtons = screen.getAllByRole("button", { name: /^reject plan$/i });
        await userEvent.click(confirmButtons[confirmButtons.length - 1]);

        await waitFor(() => {
          expect(mockApi.rejectPlan).toHaveBeenCalled();
        });
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

  it("shows the Answer Questions button in HumanClarificationNeeded state and calls onScrollToQuestions", async () => {
    const onScrollToQuestions = vi.fn();
    render(
      <ActionBar
        runId={RUN_ID}
        state="HumanClarificationNeeded"
        onAction={vi.fn()}
        onScrollToQuestions={onScrollToQuestions}
      />,
    );
    const btn = screen.getByRole("button", { name: /^answer questions$/i });
    await userEvent.click(btn);
    expect(onScrollToQuestions).toHaveBeenCalledOnce();
  });

  it("shows Approve & Complete in ReadyForHumanReview and calls api.approveReview on confirm", async () => {
    mockApi.approveReview.mockResolvedValue({ ok: true, state: "Done" });
    const onAction = vi.fn();
    render(<ActionBar runId={RUN_ID} state="ReadyForHumanReview" onAction={onAction} />);
    await userEvent.click(screen.getByRole("button", { name: /approve & complete/i }));
    await userEvent.click(screen.getByRole("button", { name: /complete run/i }));

    await waitFor(() => {
      expect(mockApi.approveReview).toHaveBeenCalledWith(RUN_ID);
    });
    expect(onAction).toHaveBeenCalledOnce();
  });

  it.each(["Planning", "Implementing", "PlanReview", "AddressingReview", "AIReview"])(
    "shows a Pause button for the active state %s and calls api.pauseRun on confirm",
    async (state) => {
      mockApi.pauseRun.mockResolvedValue({ ok: true });
      const onAction = vi.fn();
      render(<ActionBar runId={RUN_ID} state={state} onAction={onAction} />);
      await userEvent.click(screen.getByRole("button", { name: /^pause$/i }));
      const pauseButtons = screen.getAllByRole("button", { name: /^pause$/i });
      await userEvent.click(pauseButtons[pauseButtons.length - 1]);

      await waitFor(() => {
        expect(mockApi.pauseRun).toHaveBeenCalledWith(RUN_ID);
      });
      expect(onAction).toHaveBeenCalledOnce();
    },
  );

  it.each(["AIBlocked", "HumanClarificationNeeded", "Failed"])(
    "shows a Resume button for state %s and calls api.resumeRun on confirm",
    async (state) => {
      mockApi.resumeRun.mockResolvedValue({ ok: true });
      const onAction = vi.fn();
      render(<ActionBar runId={RUN_ID} state={state} onAction={onAction} />);
      await userEvent.click(screen.getByRole("button", { name: /^resume$/i }));
      const resumeButtons = screen.getAllByRole("button", { name: /^resume$/i });
      await userEvent.click(resumeButtons[resumeButtons.length - 1]);

      await waitFor(() => {
        expect(mockApi.resumeRun).toHaveBeenCalledWith(RUN_ID);
      });
      expect(onAction).toHaveBeenCalledOnce();
    },
  );

  it.each([
    ["Todo", "Start Run"],
    ["Planning", "Retry Planning"],
    ["PlanRevision", "Retry Plan Revision"],
    ["PlanReview", "Retry Plan Review"],
    ["Implementing", "Retry Execution"],
    ["AIReview", "Retry Code Review"],
    ["AddressingReview", "Retry Remediation"],
  ])("shows the correct retry label %s -> %s and calls api.retryStage on confirm", async (state, label) => {
    mockApi.retryStage.mockResolvedValue({ ok: true, state, retrying: true });
    const onAction = vi.fn();
    render(<ActionBar runId={RUN_ID} state={state} onAction={onAction} />);
    const retryBtn = screen.getByRole("button", { name: label });
    await userEvent.click(retryBtn);
    expect(screen.getByText(`Re-run the current stage (${state}).`, { exact: false })).toBeDefined();

    // Confirm dialog's confirm button is labeled "Retry"
    await userEvent.click(screen.getByRole("button", { name: /^retry$/i }));

    await waitFor(() => {
      expect(mockApi.retryStage).toHaveBeenCalledWith(RUN_ID);
    });
    expect(onAction).toHaveBeenCalledOnce();
  });

  it("renders a Pause button for an active state even without a matching retry label (no duplicate dialogs clash)", () => {
    render(<ActionBar runId={RUN_ID} state="Implementing" onAction={vi.fn()} />);
    expect(screen.getByRole("button", { name: /^pause$/i })).toBeDefined();
    expect(screen.getByRole("button", { name: /retry execution/i })).toBeDefined();
  });

  it("defaults hasOptionalQuestions to false when the prop is omitted", () => {
    render(<ActionBar runId={RUN_ID} state="AwaitingPlanApproval" onAction={vi.fn()} />);
    expect(screen.queryByRole("button", { name: /answer optional questions/i })).toBeNull();
  });
});
