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

/**
 * Some dialog confirm buttons share their visible label with the trigger
 * button that opened them (e.g. "Pause", "Resume", "Reject Plan"). Both
 * remain in the DOM while the dialog is open, so disambiguate by clicking
 * the last matching button (the dialog's own confirm button, appended after
 * the action bar's trigger buttons).
 */
async function clickLast(name: string | RegExp) {
  const user = userEvent.setup();
  const matches = screen.getAllByRole("button", { name });
  await user.click(matches[matches.length - 1]);
}

describe("ActionBar", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("renders nothing for a state with no available actions", () => {
    const { container } = render(
      <ActionBar runId={RUN_ID} state="Done" onAction={vi.fn()} />,
    );
    expect(container.firstChild).toBeNull();
  });

  describe("AwaitingPlanApproval state", () => {
    it("shows Approve Plan, Reject Plan, Re-review Plan, and Revise Plan buttons", () => {
      render(<ActionBar runId={RUN_ID} state="AwaitingPlanApproval" onAction={vi.fn()} />);
      expect(screen.getByRole("button", { name: /Approve Plan/i })).toBeDefined();
      expect(screen.getByRole("button", { name: /Reject Plan/i })).toBeDefined();
      expect(screen.getByRole("button", { name: /Re-review Plan/i })).toBeDefined();
      expect(screen.getByRole("button", { name: /Revise Plan/i })).toBeDefined();
    });

    it("does not show the Answer Optional Questions button when hasOptionalQuestions is false", () => {
      render(<ActionBar runId={RUN_ID} state="AwaitingPlanApproval" onAction={vi.fn()} />);
      expect(screen.queryByRole("button", { name: /Answer Optional Questions/i })).toBeNull();
    });

    it("shows and wires the Answer Optional Questions button when hasOptionalQuestions is true", async () => {
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
      const btn = screen.getByRole("button", { name: /Answer Optional Questions/i });
      await userEvent.click(btn);
      expect(onScrollToQuestions).toHaveBeenCalledOnce();
    });

    it("opens a confirm dialog and calls api.approvePlan with a trimmed note on confirm", async () => {
      mockApi.approvePlan.mockResolvedValue({ ok: true, state: "Implementing" });
      const onAction = vi.fn();
      render(
        <ActionBar runId={RUN_ID} state="AwaitingPlanApproval" onAction={onAction} />,
      );

      await userEvent.click(screen.getByRole("button", { name: /^Approve Plan$/i }));
      expect(screen.getByText("This will approve the current plan and start implementation. The AI agent will begin coding.")).toBeDefined();

      const textarea = screen.getByPlaceholderText(/extra context/i);
      await userEvent.type(textarea, "  watch out for X  ");
      await userEvent.click(screen.getByRole("button", { name: "Approve & Start" }));

      await waitFor(() => {
        expect(mockApi.approvePlan).toHaveBeenCalledWith(RUN_ID, "watch out for X");
        expect(onAction).toHaveBeenCalledOnce();
      });
      // Dialog closes after confirming
      expect(screen.queryByText("Approve & Start")).toBeNull();
    });

    it("shows a loading spinner while the confirm action is pending, then clears it", async () => {
      let resolveFn!: (v: unknown) => void;
      mockApi.approvePlan.mockReturnValue(new Promise((res) => (resolveFn = res)));

      render(<ActionBar runId={RUN_ID} state="AwaitingPlanApproval" onAction={vi.fn()} />);
      await userEvent.click(screen.getByRole("button", { name: /^Approve Plan$/i }));
      await userEvent.click(screen.getByRole("button", { name: "Approve & Start" }));

      expect(screen.getByText("Working...")).toBeDefined();

      resolveFn({ ok: true });
      await waitFor(() => {
        expect(screen.queryByText("Working...")).toBeNull();
      });
    });

    it("closes the confirm dialog and does not call onAction when the dialog action rejects", async () => {
      mockApi.approvePlan.mockRejectedValue(new Error("boom"));
      const onAction = vi.fn();
      render(<ActionBar runId={RUN_ID} state="AwaitingPlanApproval" onAction={onAction} />);

      await userEvent.click(screen.getByRole("button", { name: /^Approve Plan$/i }));
      await userEvent.click(screen.getByRole("button", { name: "Approve & Start" }));

      await waitFor(() => {
        expect(mockApi.approvePlan).toHaveBeenCalledOnce();
      });
      expect(onAction).not.toHaveBeenCalled();
      expect(screen.queryByText("Approve & Start")).toBeNull();
    });

    it("closes the confirm dialog via Cancel without calling the action", async () => {
      render(<ActionBar runId={RUN_ID} state="AwaitingPlanApproval" onAction={vi.fn()} />);
      await userEvent.click(screen.getByRole("button", { name: /^Approve Plan$/i }));
      expect(screen.getByText("Approve & Start")).toBeDefined();

      await userEvent.click(screen.getByRole("button", { name: "Cancel" }));
      expect(screen.queryByText("Approve & Start")).toBeNull();
      expect(mockApi.approvePlan).not.toHaveBeenCalled();
    });

    it("opens the Re-review Plan dialog and calls api.reReviewPlan with the note", async () => {
      mockApi.reReviewPlan.mockResolvedValue({ ok: true, runId: RUN_ID });
      render(<ActionBar runId={RUN_ID} state="AwaitingPlanApproval" onAction={vi.fn()} />);

      await userEvent.click(screen.getByRole("button", { name: /Re-review Plan/i }));
      expect(screen.getByText("Re-review")).toBeDefined();
      const textarea = screen.getByPlaceholderText(/focus on the test plan/i);
      await userEvent.type(textarea, "please double-check tests");
      await userEvent.click(screen.getByRole("button", { name: "Re-review" }));

      await waitFor(() => {
        expect(mockApi.reReviewPlan).toHaveBeenCalledWith(RUN_ID, "please double-check tests");
      });
    });

    it("opens the Revise Plan dialog and calls api.revisePlan with no note when left blank", async () => {
      mockApi.revisePlan.mockResolvedValue({ ok: true, runId: RUN_ID });
      render(<ActionBar runId={RUN_ID} state="AwaitingPlanApproval" onAction={vi.fn()} />);

      await userEvent.click(screen.getByRole("button", { name: /Revise Plan/i }));
      await userEvent.click(screen.getByRole("button", { name: "Revise" }));

      await waitFor(() => {
        expect(mockApi.revisePlan).toHaveBeenCalledWith(RUN_ID, undefined);
      });
    });

    it("opens the custom Reject Plan dialog (not the generic ConfirmDialog)", async () => {
      render(<ActionBar runId={RUN_ID} state="AwaitingPlanApproval" onAction={vi.fn()} />);
      await userEvent.click(screen.getByRole("button", { name: /^Reject Plan$/i }));
      expect(screen.getByText("This will reject the current plan and send it back for re-planning.")).toBeDefined();
      expect(screen.getByText("Iterate with full context")).toBeDefined();
      expect(screen.getByText("Clean slate, feedback only")).toBeDefined();
    });

    it("rejects the plan with the default 'iterate' mode and trimmed feedback", async () => {
      mockApi.rejectPlan.mockResolvedValue({ ok: true, state: "Planning" });
      const onAction = vi.fn();
      render(<ActionBar runId={RUN_ID} state="AwaitingPlanApproval" onAction={onAction} />);

      await userEvent.click(screen.getByRole("button", { name: /^Reject Plan$/i }));
      const textarea = screen.getByPlaceholderText(/describe what should change/i);
      await userEvent.type(textarea, "  needs more detail  ");
      await clickLast(/^Reject Plan$/i);

      await waitFor(() => {
        expect(mockApi.rejectPlan).toHaveBeenCalledWith(RUN_ID, "needs more detail", "iterate");
        expect(onAction).toHaveBeenCalledOnce();
      });
      // Dialog is dismissed after success
      expect(screen.queryByText("Iterate with full context")).toBeNull();
    });

    it("rejects the plan in 'fresh' mode when selected, and passes undefined for blank feedback", async () => {
      mockApi.rejectPlan.mockResolvedValue({ ok: true, state: "Planning" });
      render(<ActionBar runId={RUN_ID} state="AwaitingPlanApproval" onAction={vi.fn()} />);

      await userEvent.click(screen.getByRole("button", { name: /^Reject Plan$/i }));
      await userEvent.click(screen.getByText("Start fresh"));
      await clickLast(/^Reject Plan$/i);

      await waitFor(() => {
        expect(mockApi.rejectPlan).toHaveBeenCalledWith(RUN_ID, undefined, "fresh");
      });
    });

    it("allows switching back to 'iterate' mode explicitly after selecting 'fresh'", async () => {
      mockApi.rejectPlan.mockResolvedValue({ ok: true, state: "Planning" });
      render(<ActionBar runId={RUN_ID} state="AwaitingPlanApproval" onAction={vi.fn()} />);

      await userEvent.click(screen.getByRole("button", { name: /^Reject Plan$/i }));
      await userEvent.click(screen.getByText("Start fresh"));
      await userEvent.click(screen.getByText("Revise plan"));
      await clickLast(/^Reject Plan$/i);

      await waitFor(() => {
        expect(mockApi.rejectPlan).toHaveBeenCalledWith(RUN_ID, undefined, "iterate");
      });
    });

    it("shows a spinner in the reject dialog while pending and clears the dialog after resolution", async () => {
      let resolveFn!: (v: unknown) => void;
      mockApi.rejectPlan.mockReturnValue(new Promise((res) => (resolveFn = res)));

      render(<ActionBar runId={RUN_ID} state="AwaitingPlanApproval" onAction={vi.fn()} />);
      await userEvent.click(screen.getByRole("button", { name: /^Reject Plan$/i }));
      await clickLast(/^Reject Plan$/i);

      expect(screen.getByText("Working...")).toBeDefined();
      resolveFn({ ok: true });

      await waitFor(() => {
        expect(screen.queryByText("Working...")).toBeNull();
      });
    });

    it("resets and does not call rejectPlan when the reject dialog is cancelled", async () => {
      render(<ActionBar runId={RUN_ID} state="AwaitingPlanApproval" onAction={vi.fn()} />);
      await userEvent.click(screen.getByRole("button", { name: /^Reject Plan$/i }));
      const textarea = screen.getByPlaceholderText(/describe what should change/i);
      await userEvent.type(textarea, "some feedback");

      await userEvent.click(screen.getByRole("button", { name: "Cancel" }));
      expect(screen.queryByText("Iterate with full context")).toBeNull();
      expect(mockApi.rejectPlan).not.toHaveBeenCalled();

      // Re-opening shows the feedback field cleared (state was reset)
      await userEvent.click(screen.getByRole("button", { name: /^Reject Plan$/i }));
      expect(
        (screen.getByPlaceholderText(/describe what should change/i) as HTMLTextAreaElement)
          .value,
      ).toBe("");
    });

    it("stays open (does not call onAction) when rejectPlan rejects", async () => {
      mockApi.rejectPlan.mockRejectedValue(new Error("network down"));
      const onAction = vi.fn();
      render(<ActionBar runId={RUN_ID} state="AwaitingPlanApproval" onAction={onAction} />);

      await userEvent.click(screen.getByRole("button", { name: /^Reject Plan$/i }));
      await clickLast(/^Reject Plan$/i);

      await waitFor(() => {
        expect(mockApi.rejectPlan).toHaveBeenCalledOnce();
      });
      expect(onAction).not.toHaveBeenCalled();
    });
  });

  describe("ReadyForHumanReview state", () => {
    it("shows Approve & Complete and calls api.approveReview with no notes field", async () => {
      mockApi.approveReview.mockResolvedValue({ ok: true, state: "Done" });
      const onAction = vi.fn();
      render(<ActionBar runId={RUN_ID} state="ReadyForHumanReview" onAction={onAction} />);

      await userEvent.click(screen.getByRole("button", { name: /Approve & Complete/i }));
      expect(screen.queryByRole("textbox")).toBeNull();
      await userEvent.click(screen.getByRole("button", { name: "Complete Run" }));

      await waitFor(() => {
        expect(mockApi.approveReview).toHaveBeenCalledWith(RUN_ID);
        expect(onAction).toHaveBeenCalledOnce();
      });
    });
  });

  describe("active-category states", () => {
    it("shows Pause and Retry Execution together for Implementing, and calls the right APIs", async () => {
      mockApi.pauseRun.mockResolvedValue({ ok: true });
      mockApi.retryStage.mockResolvedValue({ ok: true, state: "Implementing", retrying: true });
      const onAction = vi.fn();
      render(<ActionBar runId={RUN_ID} state="Implementing" onAction={onAction} />);

      expect(screen.getByRole("button", { name: /Pause/i })).toBeDefined();
      expect(screen.getByRole("button", { name: /Retry Execution/i })).toBeDefined();

      await userEvent.click(screen.getByRole("button", { name: /^Pause$/i }));
      expect(screen.getByText("This will pause the run. You can resume it later.")).toBeDefined();
      await clickLast("Pause");

      await waitFor(() => {
        expect(mockApi.pauseRun).toHaveBeenCalledWith(RUN_ID);
        expect(onAction).toHaveBeenCalledOnce();
      });
    });
  });

  describe("Resume-eligible states", () => {
    it("shows Resume for AIBlocked and calls api.resumeRun", async () => {
      mockApi.resumeRun.mockResolvedValue({ ok: true });
      const onAction = vi.fn();
      render(<ActionBar runId={RUN_ID} state="AIBlocked" onAction={onAction} />);

      expect(screen.queryByRole("button", { name: /Pause/i })).toBeNull();
      await userEvent.click(screen.getByRole("button", { name: /Resume/i }));
      expect(screen.getByText("This will reset the run back to the start. It will begin re-planning.")).toBeDefined();
      await clickLast("Resume");

      await waitFor(() => {
        expect(mockApi.resumeRun).toHaveBeenCalledWith(RUN_ID);
        expect(onAction).toHaveBeenCalledOnce();
      });
    });

    it("shows Resume and Answer Questions together for HumanClarificationNeeded", async () => {
      const onScrollToQuestions = vi.fn();
      render(
        <ActionBar
          runId={RUN_ID}
          state="HumanClarificationNeeded"
          onAction={vi.fn()}
          onScrollToQuestions={onScrollToQuestions}
        />,
      );
      expect(screen.getByRole("button", { name: /Resume/i })).toBeDefined();
      const answerBtn = screen.getByRole("button", { name: /Answer Questions/i });
      await userEvent.click(answerBtn);
      expect(onScrollToQuestions).toHaveBeenCalledOnce();
    });

    it("shows Resume for a Failed run", () => {
      render(<ActionBar runId={RUN_ID} state="Failed" onAction={vi.fn()} />);
      expect(screen.getByRole("button", { name: /Resume/i })).toBeDefined();
    });
  });

  describe("Retry-eligible states (RETRY_LABELS)", () => {
    it("shows 'Start Run' for Todo and calls api.retryStage on confirm", async () => {
      mockApi.retryStage.mockResolvedValue({ ok: true, state: "Todo", retrying: true });
      const onAction = vi.fn();
      render(<ActionBar runId={RUN_ID} state="Todo" onAction={onAction} />);

      const btn = screen.getByRole("button", { name: "Start Run" });
      await userEvent.click(btn);
      expect(
        screen.getByText(/Re-run the current stage \(Todo\)\. The agent will pick up from where it left off using existing artifacts\./),
      ).toBeDefined();
      await userEvent.click(screen.getByRole("button", { name: "Retry" }));

      await waitFor(() => {
        expect(mockApi.retryStage).toHaveBeenCalledWith(RUN_ID);
        expect(onAction).toHaveBeenCalledOnce();
      });
    });

    it("shows 'Retry Plan Revision' for PlanRevision", () => {
      render(<ActionBar runId={RUN_ID} state="PlanRevision" onAction={vi.fn()} />);
      expect(screen.getByRole("button", { name: "Retry Plan Revision" })).toBeDefined();
    });

    it("shows 'Retry Plan Review' for PlanReview", () => {
      render(<ActionBar runId={RUN_ID} state="PlanReview" onAction={vi.fn()} />);
      expect(screen.getByRole("button", { name: "Retry Plan Review" })).toBeDefined();
    });

    it("shows 'Retry Code Review' for AIReview", () => {
      render(<ActionBar runId={RUN_ID} state="AIReview" onAction={vi.fn()} />);
      expect(screen.getByRole("button", { name: "Retry Code Review" })).toBeDefined();
    });

    it("shows 'Retry Remediation' for AddressingReview", () => {
      render(<ActionBar runId={RUN_ID} state="AddressingReview" onAction={vi.fn()} />);
      expect(screen.getByRole("button", { name: "Retry Remediation" })).toBeDefined();
    });

    it("shows 'Retry Planning' for Planning", () => {
      render(<ActionBar runId={RUN_ID} state="Planning" onAction={vi.fn()} />);
      expect(screen.getByRole("button", { name: "Retry Planning" })).toBeDefined();
    });
  });
});
