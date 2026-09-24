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

  it("renders nothing for a state with no actions", () => {
    const { container } = render(
      <ActionBar runId={RUN_ID} state="Done" onAction={vi.fn()} />,
    );
    expect(container.firstChild).toBeNull();
  });

  it("Todo state (in RETRY_LABELS) renders a 'Start Run' button", () => {
    render(<ActionBar runId={RUN_ID} state="Todo" onAction={vi.fn()} />);
    expect(screen.getByText("Start Run")).toBeDefined();
  });

  describe("AwaitingPlanApproval state", () => {
    it("renders Approve Plan, Reject Plan, Re-review Plan, and Revise Plan buttons", () => {
      render(
        <ActionBar runId={RUN_ID} state="AwaitingPlanApproval" onAction={vi.fn()} />,
      );
      expect(screen.getByText("Approve Plan")).toBeDefined();
      expect(screen.getByText("Reject Plan")).toBeDefined();
      expect(screen.getByText("Re-review Plan")).toBeDefined();
      expect(screen.getByText("Revise Plan")).toBeDefined();
    });

    it("does not render the Answer Optional Questions button when hasOptionalQuestions is false", () => {
      render(
        <ActionBar runId={RUN_ID} state="AwaitingPlanApproval" onAction={vi.fn()} />,
      );
      expect(screen.queryByText("Answer Optional Questions")).toBeNull();
    });

    it("renders Answer Optional Questions button when hasOptionalQuestions is true and calls onScrollToQuestions on click", async () => {
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
      const btn = screen.getByText("Answer Optional Questions");
      await userEvent.click(btn);
      expect(onScrollToQuestions).toHaveBeenCalledOnce();
    });

    it("clicking Approve Plan opens the confirm dialog, and confirming calls api.approvePlan then onAction", async () => {
      mockApi.approvePlan.mockResolvedValue({ ok: true, state: "Implementing" });
      const onAction = vi.fn();
      render(
        <ActionBar runId={RUN_ID} state="AwaitingPlanApproval" onAction={onAction} />,
      );

      await userEvent.click(screen.getByText("Approve Plan"));
      expect(screen.getByText(/This will approve the current plan/i)).toBeDefined();

      const confirmBtn = screen.getByRole("button", { name: /approve & start/i });
      await userEvent.click(confirmBtn);

      await waitFor(() => {
        expect(mockApi.approvePlan).toHaveBeenCalledWith(RUN_ID, undefined);
      });
      await waitFor(() => {
        expect(onAction).toHaveBeenCalledOnce();
      });
    });

    it("clicking Approve Plan then typing a note and confirming passes the trimmed note", async () => {
      mockApi.approvePlan.mockResolvedValue({ ok: true, state: "Implementing" });
      render(
        <ActionBar runId={RUN_ID} state="AwaitingPlanApproval" onAction={vi.fn()} />,
      );

      await userEvent.click(screen.getByText("Approve Plan"));
      const textarea = screen.getByPlaceholderText(/extra context/i);
      await userEvent.type(textarea, "  watch for edge cases  ");
      await userEvent.click(screen.getByRole("button", { name: /approve & start/i }));

      await waitFor(() => {
        expect(mockApi.approvePlan).toHaveBeenCalledWith(RUN_ID, "watch for edge cases");
      });
    });

    it("does not call approvePlan if dialog is cancelled", async () => {
      render(
        <ActionBar runId={RUN_ID} state="AwaitingPlanApproval" onAction={vi.fn()} />,
      );
      await userEvent.click(screen.getByText("Approve Plan"));
      await userEvent.click(screen.getByRole("button", { name: /cancel/i }));
      expect(mockApi.approvePlan).not.toHaveBeenCalled();
      expect(screen.queryByText(/This will approve the current plan/i)).toBeNull();
    });

    it("clicking Reject Plan opens the custom reject dialog with mode toggle and textarea", async () => {
      render(
        <ActionBar runId={RUN_ID} state="AwaitingPlanApproval" onAction={vi.fn()} />,
      );
      await userEvent.click(screen.getByText("Reject Plan"));
      expect(
        screen.getByText(/This will reject the current plan and send it back/i),
      ).toBeDefined();
      expect(screen.getByText("Revise plan")).toBeDefined();
      expect(screen.getByText("Start fresh")).toBeDefined();
    });

    it("reject dialog: confirming with default mode (iterate) and no feedback calls api.rejectPlan with correct args", async () => {
      mockApi.rejectPlan.mockResolvedValue({ ok: true, state: "Planning" });
      const onAction = vi.fn();
      render(
        <ActionBar runId={RUN_ID} state="AwaitingPlanApproval" onAction={onAction} />,
      );
      await userEvent.click(screen.getByText("Reject Plan"));

      // The dialog's confirm button also reads "Reject Plan" - use the last one (dialog's)
      const rejectButtons = screen.getAllByText("Reject Plan");
      const confirmBtn = rejectButtons[rejectButtons.length - 1];
      await userEvent.click(confirmBtn);

      await waitFor(() => {
        expect(mockApi.rejectPlan).toHaveBeenCalledWith(RUN_ID, undefined, "iterate");
      });
      await waitFor(() => {
        expect(onAction).toHaveBeenCalledOnce();
      });
    });

    it("reject dialog: switching to 'Start fresh' mode and adding feedback calls api.rejectPlan with fresh mode and trimmed feedback", async () => {
      mockApi.rejectPlan.mockResolvedValue({ ok: true, state: "Planning" });
      render(
        <ActionBar runId={RUN_ID} state="AwaitingPlanApproval" onAction={vi.fn()} />,
      );
      await userEvent.click(screen.getByText("Reject Plan"));

      await userEvent.click(screen.getByText("Start fresh"));
      const textarea = screen.getByPlaceholderText(/describe what should change/i);
      await userEvent.type(textarea, "  needs more detail  ");

      const rejectButtons = screen.getAllByText("Reject Plan");
      await userEvent.click(rejectButtons[rejectButtons.length - 1]);

      await waitFor(() => {
        expect(mockApi.rejectPlan).toHaveBeenCalledWith(RUN_ID, "needs more detail", "fresh");
      });
    });

    it("reject dialog: switching to 'Start fresh' then back to 'Revise plan' resets mode to iterate", async () => {
      mockApi.rejectPlan.mockResolvedValue({ ok: true, state: "Planning" });
      render(
        <ActionBar runId={RUN_ID} state="AwaitingPlanApproval" onAction={vi.fn()} />,
      );
      await userEvent.click(screen.getByText("Reject Plan"));

      await userEvent.click(screen.getByText("Start fresh"));
      await userEvent.click(screen.getByText("Revise plan"));

      const rejectButtons = screen.getAllByText("Reject Plan");
      await userEvent.click(rejectButtons[rejectButtons.length - 1]);

      await waitFor(() => {
        expect(mockApi.rejectPlan).toHaveBeenCalledWith(RUN_ID, undefined, "iterate");
      });
    });

    it("reject dialog: clicking Cancel closes without calling api.rejectPlan", async () => {
      render(
        <ActionBar runId={RUN_ID} state="AwaitingPlanApproval" onAction={vi.fn()} />,
      );
      await userEvent.click(screen.getByText("Reject Plan"));
      await userEvent.click(screen.getByRole("button", { name: /cancel/i }));
      expect(mockApi.rejectPlan).not.toHaveBeenCalled();
      expect(
        screen.queryByText(/This will reject the current plan and send it back/i),
      ).toBeNull();
    });

    it("clicking Re-review Plan opens dialog and confirming calls api.reReviewPlan", async () => {
      mockApi.reReviewPlan.mockResolvedValue({ ok: true, state: "PlanReview" });
      render(
        <ActionBar runId={RUN_ID} state="AwaitingPlanApproval" onAction={vi.fn()} />,
      );
      await userEvent.click(screen.getByText("Re-review Plan"));
      expect(screen.getByText(/Run the plan reviewer again/i)).toBeDefined();
      await userEvent.click(screen.getByRole("button", { name: /^re-review$/i }));
      await waitFor(() => {
        expect(mockApi.reReviewPlan).toHaveBeenCalledWith(RUN_ID, undefined);
      });
    });

    it("clicking Revise Plan opens dialog and confirming calls api.revisePlan", async () => {
      mockApi.revisePlan.mockResolvedValue({ ok: true, state: "PlanRevision" });
      render(
        <ActionBar runId={RUN_ID} state="AwaitingPlanApproval" onAction={vi.fn()} />,
      );
      await userEvent.click(screen.getByText("Revise Plan"));
      expect(screen.getByText(/automatically run the plan reviser/i)).toBeDefined();
      await userEvent.click(screen.getByRole("button", { name: /^revise$/i }));
      await waitFor(() => {
        expect(mockApi.revisePlan).toHaveBeenCalledWith(RUN_ID, undefined);
      });
    });
  });

  it("ReadyForHumanReview: renders Approve & Complete button and calls api.approveReview on confirm", async () => {
    mockApi.approveReview.mockResolvedValue({ ok: true, state: "Done" });
    const onAction = vi.fn();
    render(
      <ActionBar runId={RUN_ID} state="ReadyForHumanReview" onAction={onAction} />,
    );
    await userEvent.click(screen.getByText("Approve & Complete"));
    await userEvent.click(screen.getByRole("button", { name: /complete run/i }));
    await waitFor(() => {
      expect(mockApi.approveReview).toHaveBeenCalledWith(RUN_ID);
    });
    await waitFor(() => {
      expect(onAction).toHaveBeenCalledOnce();
    });
  });

  it("active category state (e.g. Implementing) renders a Pause button and calls api.pauseRun on confirm", async () => {
    mockApi.pauseRun.mockResolvedValue({ ok: true, state: "AIBlocked" });
    render(<ActionBar runId={RUN_ID} state="Implementing" onAction={vi.fn()} />);
    // Implementing is also in RETRY_LABELS, so both Pause and Retry Execution show
    expect(screen.getByText("Pause")).toBeDefined();
    expect(screen.getByText("Retry Execution")).toBeDefined();

    await userEvent.click(screen.getByText("Pause"));
    const pauseButtons = screen.getAllByRole("button", { name: /^pause$/i });
    await userEvent.click(pauseButtons[pauseButtons.length - 1]);
    await waitFor(() => {
      expect(mockApi.pauseRun).toHaveBeenCalledWith(RUN_ID);
    });
  });

  it.each(["AIBlocked", "HumanClarificationNeeded", "Failed"])(
    "%s state renders a Resume button and calls api.resumeRun on confirm",
    async (state) => {
      mockApi.resumeRun.mockResolvedValue({ ok: true, state: "Planning" });
      const onAction = vi.fn();
      render(<ActionBar runId={RUN_ID} state={state} onAction={onAction} />);
      const resumeButtons = screen.getAllByText("Resume");
      await userEvent.click(resumeButtons[0]);
      expect(screen.getByText(/This will reset the run back to the start/i)).toBeDefined();
      const confirmButtons = screen.getAllByRole("button", { name: /^resume$/i });
      await userEvent.click(confirmButtons[confirmButtons.length - 1]);
      await waitFor(() => {
        expect(mockApi.resumeRun).toHaveBeenCalledWith(RUN_ID);
      });
      await waitFor(() => {
        expect(onAction).toHaveBeenCalledOnce();
      });
    },
  );

  it("HumanClarificationNeeded renders the Answer Questions button and it calls onScrollToQuestions", async () => {
    const onScrollToQuestions = vi.fn();
    render(
      <ActionBar
        runId={RUN_ID}
        state="HumanClarificationNeeded"
        onAction={vi.fn()}
        onScrollToQuestions={onScrollToQuestions}
      />,
    );
    const btn = screen.getByText("Answer Questions");
    await userEvent.click(btn);
    expect(onScrollToQuestions).toHaveBeenCalledOnce();
  });

  it.each([
    ["Planning", "Retry Planning"],
    ["PlanRevision", "Retry Plan Revision"],
    ["PlanReview", "Retry Plan Review"],
    ["AIReview", "Retry Code Review"],
    ["AddressingReview", "Retry Remediation"],
  ])("%s state renders '%s' retry button and calls api.retryStage on confirm", async (state, label) => {
    mockApi.retryStage.mockResolvedValue({ ok: true, state });
    render(<ActionBar runId={RUN_ID} state={state} onAction={vi.fn()} />);
    await userEvent.click(screen.getByText(label));
    expect(screen.getByText(new RegExp(`Re-run the current stage \\(${state}\\)`))).toBeDefined();
    await userEvent.click(screen.getByRole("button", { name: /^retry$/i }));
    await waitFor(() => {
      expect(mockApi.retryStage).toHaveBeenCalledWith(RUN_ID);
    });
  });

  it("shows loading state on the dialog while the action promise is pending, then closes on resolve", async () => {
    let resolveAction!: (v: unknown) => void;
    mockApi.approveReview.mockReturnValue(
      new Promise((res) => {
        resolveAction = res;
      }),
    );
    render(
      <ActionBar runId={RUN_ID} state="ReadyForHumanReview" onAction={vi.fn()} />,
    );
    await userEvent.click(screen.getByText("Approve & Complete"));
    await userEvent.click(screen.getByRole("button", { name: /complete run/i }));

    expect(screen.getByText(/Working.../i)).toBeDefined();

    resolveAction({ ok: true, state: "Done" });

    await waitFor(() => {
      expect(screen.queryByText(/This will mark the run as complete/i)).toBeNull();
    });
  });

  it("keeps dialog silently closing when the action promise rejects (handled by client)", async () => {
    mockApi.approveReview.mockRejectedValue(new Error("network error"));
    const onAction = vi.fn();
    render(
      <ActionBar runId={RUN_ID} state="ReadyForHumanReview" onAction={onAction} />,
    );
    await userEvent.click(screen.getByText("Approve & Complete"));
    await userEvent.click(screen.getByRole("button", { name: /complete run/i }));

    await waitFor(() => {
      expect(screen.queryByText(/This will mark the run as complete/i)).toBeNull();
    });
    // onAction should NOT be called when the action throws
    expect(onAction).not.toHaveBeenCalled();
  });
});
