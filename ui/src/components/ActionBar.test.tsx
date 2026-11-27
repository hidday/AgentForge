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

  it("renders null when no actions apply for the given state", () => {
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
      // Not applicable in this state
      expect(screen.queryByRole("button", { name: /^pause$/i })).toBeNull();
      expect(screen.queryByRole("button", { name: /^resume$/i })).toBeNull();
    });

    it("does not show Answer Optional Questions button when hasOptionalQuestions is false", () => {
      render(
        <ActionBar runId={RUN_ID} state="AwaitingPlanApproval" onAction={vi.fn()} />,
      );
      expect(
        screen.queryByRole("button", { name: /answer optional questions/i }),
      ).toBeNull();
    });

    it("shows Answer Optional Questions button when hasOptionalQuestions is true and calls onScrollToQuestions", async () => {
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

    it("requires confirmation before calling approvePlan, then calls it with trimmed note", async () => {
      mockApi.approvePlan.mockResolvedValue({ ok: true, state: "Implementing" });
      const onAction = vi.fn();
      render(
        <ActionBar runId={RUN_ID} state="AwaitingPlanApproval" onAction={onAction} />,
      );

      await userEvent.click(screen.getByRole("button", { name: /approve plan/i }));

      // Dialog should appear, api should NOT have been called yet
      expect(screen.getByRole("heading", { name: "Approve Plan" })).toBeDefined();
      expect(mockApi.approvePlan).not.toHaveBeenCalled();

      const textarea = screen.getByPlaceholderText(/extra context/i);
      await userEvent.type(textarea, "watch out for X");

      const confirmBtn = screen.getByRole("button", { name: /approve & start/i });
      await userEvent.click(confirmBtn);

      await waitFor(() => {
        expect(mockApi.approvePlan).toHaveBeenCalledWith(RUN_ID, "watch out for X");
        expect(onAction).toHaveBeenCalledOnce();
      });
    });

    it("closes the confirm dialog without calling the API when cancelled", async () => {
      render(
        <ActionBar runId={RUN_ID} state="AwaitingPlanApproval" onAction={vi.fn()} />,
      );
      await userEvent.click(screen.getByRole("button", { name: /approve plan/i }));
      expect(screen.getByRole("heading", { name: "Approve Plan" })).toBeDefined();

      await userEvent.click(screen.getByRole("button", { name: /cancel/i }));

      expect(screen.queryByRole("heading", { name: "Approve Plan" })).toBeNull();
      expect(mockApi.approvePlan).not.toHaveBeenCalled();
    });

    it("keeps the dialog usable after approvePlan rejects (handled error path)", async () => {
      mockApi.approvePlan.mockRejectedValue(new Error("boom"));
      const onAction = vi.fn();
      render(
        <ActionBar runId={RUN_ID} state="AwaitingPlanApproval" onAction={onAction} />,
      );

      await userEvent.click(screen.getByRole("button", { name: /approve plan/i }));
      await userEvent.click(screen.getByRole("button", { name: /approve & start/i }));

      await waitFor(() => {
        expect(mockApi.approvePlan).toHaveBeenCalledOnce();
      });
      // Dialog is closed regardless of outcome (error is swallowed, handled by client)
      expect(screen.queryByRole("heading", { name: "Approve Plan" })).toBeNull();
      // onAction should not have been invoked since the action threw
      expect(onAction).not.toHaveBeenCalled();
    });

    it("opens the Reject Plan dialog, requires explicit confirm, and calls rejectPlan with iterate mode by default", async () => {
      mockApi.rejectPlan.mockResolvedValue({ ok: true, state: "Planning" });
      const onAction = vi.fn();
      render(
        <ActionBar runId={RUN_ID} state="AwaitingPlanApproval" onAction={onAction} />,
      );

      await userEvent.click(screen.getByRole("button", { name: /reject plan/i }));

      // Custom reject dialog is shown with mode toggle; API not yet called
      expect(screen.getByRole("heading", { name: "Reject Plan" })).toBeDefined();
      expect(screen.getByRole("button", { name: /start fresh/i })).toBeDefined();
      expect(mockApi.rejectPlan).not.toHaveBeenCalled();

      const feedback = screen.getByPlaceholderText(/describe what should change/i);
      await userEvent.type(feedback, "needs more detail");

      // Confirm via the dialog's own "Reject Plan" submit button (there are two
      // elements with this text now: the trigger button is gone once dialog opens)
      const submitButtons = screen.getAllByRole("button", { name: /reject plan/i });
      await userEvent.click(submitButtons[submitButtons.length - 1]);

      await waitFor(() => {
        expect(mockApi.rejectPlan).toHaveBeenCalledWith(RUN_ID, "needs more detail", "iterate");
        expect(onAction).toHaveBeenCalledOnce();
      });
    });

    it("switches to fresh mode when 'Start fresh' is selected before confirming reject", async () => {
      mockApi.rejectPlan.mockResolvedValue({ ok: true, state: "Planning" });
      render(
        <ActionBar runId={RUN_ID} state="AwaitingPlanApproval" onAction={vi.fn()} />,
      );

      await userEvent.click(screen.getByRole("button", { name: /reject plan/i }));
      await userEvent.click(screen.getByRole("button", { name: /start fresh/i }));

      const submitButtons = screen.getAllByRole("button", { name: /reject plan/i });
      await userEvent.click(submitButtons[submitButtons.length - 1]);

      await waitFor(() => {
        expect(mockApi.rejectPlan).toHaveBeenCalledWith(RUN_ID, undefined, "fresh");
      });
    });

    it("can switch back to iterate mode after selecting fresh, before confirming reject", async () => {
      mockApi.rejectPlan.mockResolvedValue({ ok: true, state: "Planning" });
      render(
        <ActionBar runId={RUN_ID} state="AwaitingPlanApproval" onAction={vi.fn()} />,
      );

      await userEvent.click(screen.getByRole("button", { name: /reject plan/i }));
      await userEvent.click(screen.getByRole("button", { name: /start fresh/i }));
      const iterateToggle = screen.getByText(/iterate with full context/i).closest("button");
      expect(iterateToggle).not.toBeNull();
      await userEvent.click(iterateToggle as HTMLButtonElement);

      const submitButtons = screen.getAllByRole("button", { name: /reject plan/i });
      await userEvent.click(submitButtons[submitButtons.length - 1]);

      await waitFor(() => {
        expect(mockApi.rejectPlan).toHaveBeenCalledWith(RUN_ID, undefined, "iterate");
      });
    });

    it("cancels the reject dialog via the Cancel button without calling the API", async () => {
      render(
        <ActionBar runId={RUN_ID} state="AwaitingPlanApproval" onAction={vi.fn()} />,
      );
      await userEvent.click(screen.getByRole("button", { name: /reject plan/i }));
      expect(screen.getByRole("heading", { name: "Reject Plan" })).toBeDefined();

      await userEvent.click(screen.getByRole("button", { name: /cancel/i }));

      expect(screen.queryByText(/start fresh/i)).toBeNull();
      expect(mockApi.rejectPlan).not.toHaveBeenCalled();
    });

    it("cancels the reject dialog by clicking the backdrop", async () => {
      render(
        <ActionBar runId={RUN_ID} state="AwaitingPlanApproval" onAction={vi.fn()} />,
      );
      await userEvent.click(screen.getByRole("button", { name: /reject plan/i }));
      const backdrop = document.querySelector(".absolute.inset-0.bg-black\\/60");
      expect(backdrop).not.toBeNull();
      await userEvent.click(backdrop as Element);
      expect(screen.queryByText(/start fresh/i)).toBeNull();
    });

    it("sends undefined context when the reject feedback textarea is left blank", async () => {
      mockApi.rejectPlan.mockResolvedValue({ ok: true, state: "Planning" });
      render(
        <ActionBar runId={RUN_ID} state="AwaitingPlanApproval" onAction={vi.fn()} />,
      );
      await userEvent.click(screen.getByRole("button", { name: /reject plan/i }));
      const submitButtons = screen.getAllByRole("button", { name: /reject plan/i });
      await userEvent.click(submitButtons[submitButtons.length - 1]);

      await waitFor(() => {
        expect(mockApi.rejectPlan).toHaveBeenCalledWith(RUN_ID, undefined, "iterate");
      });
    });

    it("opens the Re-review Plan dialog and calls api.reReviewPlan with the note", async () => {
      mockApi.reReviewPlan.mockResolvedValue({ ok: true, runId: RUN_ID });
      const onAction = vi.fn();
      render(
        <ActionBar runId={RUN_ID} state="AwaitingPlanApproval" onAction={onAction} />,
      );

      await userEvent.click(screen.getByRole("button", { name: /re-review plan/i }));
      expect(screen.getByRole("heading", { name: "Re-review Plan" })).toBeDefined();

      const textarea = screen.getByPlaceholderText(/focus on the test plan/i);
      await userEvent.type(textarea, "check perf");

      await userEvent.click(screen.getByRole("button", { name: /^re-review$/i }));

      await waitFor(() => {
        expect(mockApi.reReviewPlan).toHaveBeenCalledWith(RUN_ID, "check perf");
        expect(onAction).toHaveBeenCalledOnce();
      });
    });

    it("opens the Revise Plan dialog and calls api.revisePlan with the note", async () => {
      mockApi.revisePlan.mockResolvedValue({ ok: true, runId: RUN_ID });
      const onAction = vi.fn();
      render(
        <ActionBar runId={RUN_ID} state="AwaitingPlanApproval" onAction={onAction} />,
      );

      await userEvent.click(screen.getByRole("button", { name: /^revise plan$/i }));
      expect(screen.getByRole("heading", { name: "Revise Plan" })).toBeDefined();

      const textarea = screen.getByPlaceholderText(/tighten the rollout step/i);
      await userEvent.type(textarea, "tighten step 2");

      await userEvent.click(screen.getByRole("button", { name: /^revise$/i }));

      await waitFor(() => {
        expect(mockApi.revisePlan).toHaveBeenCalledWith(RUN_ID, "tighten step 2");
        expect(onAction).toHaveBeenCalledOnce();
      });
    });
  });

  describe("ReadyForHumanReview state", () => {
    it("shows Approve & Complete button and calls api.approveReview on confirm", async () => {
      mockApi.approveReview.mockResolvedValue({ ok: true, state: "Done" });
      const onAction = vi.fn();
      render(
        <ActionBar runId={RUN_ID} state="ReadyForHumanReview" onAction={onAction} />,
      );

      const btn = screen.getByRole("button", { name: /approve & complete/i });
      await userEvent.click(btn);

      expect(mockApi.approveReview).not.toHaveBeenCalled();
      await userEvent.click(screen.getByRole("button", { name: /complete run/i }));

      await waitFor(() => {
        expect(mockApi.approveReview).toHaveBeenCalledWith(RUN_ID);
        expect(onAction).toHaveBeenCalledOnce();
      });
    });

    it("does not show Approve Plan or Reject Plan buttons", () => {
      render(
        <ActionBar runId={RUN_ID} state="ReadyForHumanReview" onAction={vi.fn()} />,
      );
      expect(screen.queryByRole("button", { name: /approve plan/i })).toBeNull();
      expect(screen.queryByRole("button", { name: /reject plan/i })).toBeNull();
    });
  });

  describe("Pause action (active category states)", () => {
    it.each(["Planning", "PlanReview", "PlanRevision", "Implementing", "AIReview", "AddressingReview"])(
      "shows Pause button for active state %s and calls api.pauseRun on confirm",
      async (state) => {
        mockApi.pauseRun.mockResolvedValue({ ok: true });
        const onAction = vi.fn();
        render(<ActionBar runId={RUN_ID} state={state} onAction={onAction} />);

        const pauseBtn = screen.getByRole("button", { name: /^pause$/i });
        await userEvent.click(pauseBtn);

        const pauseButtons = screen.getAllByRole("button", { name: /^pause$/i });
        await userEvent.click(pauseButtons[pauseButtons.length - 1]);

        await waitFor(() => {
          expect(mockApi.pauseRun).toHaveBeenCalledWith(RUN_ID);
          expect(onAction).toHaveBeenCalledOnce();
        });
      },
    );

    it("does not show Pause button for non-active states like Todo or Done", () => {
      render(<ActionBar runId={RUN_ID} state="Todo" onAction={vi.fn()} />);
      expect(screen.queryByRole("button", { name: /^pause$/i })).toBeNull();
    });
  });

  describe("Resume action", () => {
    it.each(["AIBlocked", "HumanClarificationNeeded", "Failed"])(
      "shows Resume button for %s and calls api.resumeRun on confirm",
      async (state) => {
        mockApi.resumeRun.mockResolvedValue({ ok: true });
        const onAction = vi.fn();
        render(<ActionBar runId={RUN_ID} state={state} onAction={onAction} />);

        await userEvent.click(screen.getByRole("button", { name: /^resume$/i }));
        const resumeButtons = screen.getAllByRole("button", { name: /^resume$/i });
        await userEvent.click(resumeButtons[resumeButtons.length - 1]);

        await waitFor(() => {
          expect(mockApi.resumeRun).toHaveBeenCalledWith(RUN_ID);
          expect(onAction).toHaveBeenCalledOnce();
        });
      },
    );

    it("shows the Answer Questions button (not Resume's dialog) for HumanClarificationNeeded and triggers onScrollToQuestions", async () => {
      const onScrollToQuestions = vi.fn();
      render(
        <ActionBar
          runId={RUN_ID}
          state="HumanClarificationNeeded"
          onAction={vi.fn()}
          onScrollToQuestions={onScrollToQuestions}
        />,
      );
      const answerBtn = screen.getByRole("button", { name: /^answer questions$/i });
      await userEvent.click(answerBtn);
      expect(onScrollToQuestions).toHaveBeenCalledOnce();
    });

    it("does not show Resume button for states outside the resume set", () => {
      render(<ActionBar runId={RUN_ID} state="Implementing" onAction={vi.fn()} />);
      expect(screen.queryByRole("button", { name: /^resume$/i })).toBeNull();
    });
  });

  describe("Retry action and RETRY_LABELS mapping", () => {
    it.each([
      ["Todo", "Start Run"],
      ["Planning", "Retry Planning"],
      ["PlanRevision", "Retry Plan Revision"],
      ["PlanReview", "Retry Plan Review"],
      ["Implementing", "Retry Execution"],
      ["AIReview", "Retry Code Review"],
      ["AddressingReview", "Retry Remediation"],
    ])("shows correct retry label %s -> %s and calls api.retryStage on confirm", async (state, label) => {
      mockApi.retryStage.mockResolvedValue({ ok: true, state, retrying: true });
      const onAction = vi.fn();
      render(<ActionBar runId={RUN_ID} state={state} onAction={onAction} />);

      const retryBtn = screen.getByRole("button", { name: label });
      await userEvent.click(retryBtn);

      expect(screen.getAllByText(label).length).toBeGreaterThan(0);

      const confirmBtn = screen.getByRole("button", { name: /^retry$/i });
      await userEvent.click(confirmBtn);

      await waitFor(() => {
        expect(mockApi.retryStage).toHaveBeenCalledWith(RUN_ID);
        expect(onAction).toHaveBeenCalledOnce();
      });
    });

    it("does not show a retry button for states not in RETRY_LABELS (e.g. ReadyForHumanReview, Done)", () => {
      render(<ActionBar runId={RUN_ID} state="Done" onAction={vi.fn()} />);
      expect(screen.queryByRole("button", { name: /retry/i })).toBeNull();
    });
  });

  describe("multiple simultaneous actions", () => {
    it("shows both Pause and a Retry-labelled button together for an active+retry-eligible state like Implementing", () => {
      render(<ActionBar runId={RUN_ID} state="Implementing" onAction={vi.fn()} />);
      expect(screen.getByRole("button", { name: /^pause$/i })).toBeDefined();
      expect(screen.getByRole("button", { name: /retry execution/i })).toBeDefined();
    });
  });
});
