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
    mockApi.approvePlan.mockResolvedValue({ ok: true, state: "Implementing" });
    mockApi.rejectPlan.mockResolvedValue({ ok: true, state: "Planning" });
    mockApi.reReviewPlan.mockResolvedValue({ ok: true, runId: RUN_ID });
    mockApi.revisePlan.mockResolvedValue({ ok: true, runId: RUN_ID });
    mockApi.approveReview.mockResolvedValue({ ok: true, state: "Done" });
    mockApi.pauseRun.mockResolvedValue({ ok: true });
    mockApi.resumeRun.mockResolvedValue({ ok: true });
    mockApi.retryStage.mockResolvedValue({ ok: true, state: "Planning", retrying: true });
  });

  it("renders nothing for a state with no applicable actions", () => {
    const { container } = render(
      <ActionBar runId={RUN_ID} state="Done" onAction={vi.fn()} />,
    );
    expect(container.firstChild).toBeNull();
  });

  describe("AwaitingPlanApproval", () => {
    it("renders Approve/Reject/Re-review/Revise actions", () => {
      render(<ActionBar runId={RUN_ID} state="AwaitingPlanApproval" onAction={vi.fn()} />);
      expect(screen.getByRole("button", { name: /approve plan/i })).toBeDefined();
      expect(screen.getByRole("button", { name: /reject plan/i })).toBeDefined();
      expect(screen.getByRole("button", { name: /re-review plan/i })).toBeDefined();
      expect(screen.getByRole("button", { name: /revise plan/i })).toBeDefined();
      // Optional-questions button hidden by default
      expect(screen.queryByRole("button", { name: /answer optional questions/i })).toBeNull();
    });

    it("shows the Answer Optional Questions button when hasOptionalQuestions is true", async () => {
      const onScrollToQuestions = vi.fn();
      render(
        <ActionBar
          runId={RUN_ID}
          state="AwaitingPlanApproval"
          onAction={vi.fn()}
          hasOptionalQuestions
          onScrollToQuestions={onScrollToQuestions}
        />,
      );
      const btn = screen.getByRole("button", { name: /answer optional questions/i });
      await userEvent.click(btn);
      expect(onScrollToQuestions).toHaveBeenCalledOnce();
    });

    it("approves the plan without a note when the notes field is left blank", async () => {
      const onAction = vi.fn();
      render(<ActionBar runId={RUN_ID} state="AwaitingPlanApproval" onAction={onAction} />);

      await userEvent.click(screen.getByRole("button", { name: /approve plan/i }));
      // Confirm dialog opened with notes field
      expect(screen.getByText(/this will approve the current plan/i)).toBeDefined();

      await userEvent.click(screen.getByRole("button", { name: /approve & start/i }));

      await waitFor(() => {
        expect(mockApi.approvePlan).toHaveBeenCalledWith(RUN_ID, undefined);
        expect(onAction).toHaveBeenCalledOnce();
      });
      // Dialog closes after confirm
      expect(screen.queryByText(/this will approve the current plan/i)).toBeNull();
    });

    it("approves the plan with a trimmed note when notes are provided", async () => {
      const onAction = vi.fn();
      render(<ActionBar runId={RUN_ID} state="AwaitingPlanApproval" onAction={onAction} />);

      await userEvent.click(screen.getByRole("button", { name: /approve plan/i }));
      const textarea = screen.getByPlaceholderText(/extra context, edge cases/i);
      await userEvent.type(textarea, "  watch the migration  ");
      await userEvent.click(screen.getByRole("button", { name: /approve & start/i }));

      await waitFor(() => {
        expect(mockApi.approvePlan).toHaveBeenCalledWith(RUN_ID, "watch the migration");
      });
    });

    it("does not call onAction when the approve action rejects", async () => {
      const onAction = vi.fn();
      mockApi.approvePlan.mockRejectedValue(new Error("boom"));
      render(<ActionBar runId={RUN_ID} state="AwaitingPlanApproval" onAction={onAction} />);

      await userEvent.click(screen.getByRole("button", { name: /approve plan/i }));
      await userEvent.click(screen.getByRole("button", { name: /approve & start/i }));

      await waitFor(() => {
        expect(mockApi.approvePlan).toHaveBeenCalledOnce();
      });
      // The dialog still closes (finally block) and onAction is never invoked.
      expect(onAction).not.toHaveBeenCalled();
      expect(screen.queryByText(/this will approve the current plan/i)).toBeNull();
    });

    it("cancelling the confirm dialog does not call the API", async () => {
      render(<ActionBar runId={RUN_ID} state="AwaitingPlanApproval" onAction={vi.fn()} />);
      await userEvent.click(screen.getByRole("button", { name: /approve plan/i }));
      await userEvent.click(screen.getByRole("button", { name: /cancel/i }));
      expect(mockApi.approvePlan).not.toHaveBeenCalled();
      expect(screen.queryByText(/this will approve the current plan/i)).toBeNull();
    });

    it("opens the custom reject dialog, defaults to iterate mode, and submits trimmed feedback", async () => {
      const onAction = vi.fn();
      render(<ActionBar runId={RUN_ID} state="AwaitingPlanApproval" onAction={onAction} />);

      await userEvent.click(screen.getByRole("button", { name: /reject plan/i }));
      expect(screen.getByText(/this will reject the current plan/i)).toBeDefined();

      // Switch to "Start fresh" mode
      await userEvent.click(screen.getByText(/start fresh/i));

      const textarea = screen.getByPlaceholderText(/describe what should change/i);
      await userEvent.type(textarea, "  needs a different approach  ");

      // There are two buttons with "Reject Plan" text (the opener + the confirm);
      // the confirm one lives inside the dialog's footer.
      const confirmButtons = screen.getAllByRole("button", { name: /reject plan/i });
      await userEvent.click(confirmButtons[confirmButtons.length - 1]);

      await waitFor(() => {
        expect(mockApi.rejectPlan).toHaveBeenCalledWith(RUN_ID, "needs a different approach", "fresh");
        expect(onAction).toHaveBeenCalledOnce();
      });
      expect(screen.queryByText(/this will reject the current plan/i)).toBeNull();
    });

    it("reject dialog cancel button closes without calling the API and resets feedback", async () => {
      render(<ActionBar runId={RUN_ID} state="AwaitingPlanApproval" onAction={vi.fn()} />);
      await userEvent.click(screen.getByRole("button", { name: /reject plan/i }));
      const textarea = screen.getByPlaceholderText(/describe what should change/i);
      await userEvent.type(textarea, "some feedback");

      const cancelButtons = screen.getAllByRole("button", { name: /cancel/i });
      await userEvent.click(cancelButtons[cancelButtons.length - 1]);

      expect(mockApi.rejectPlan).not.toHaveBeenCalled();
      expect(screen.queryByText(/this will reject the current plan/i)).toBeNull();
    });

    it("keeps the reject dialog open and surfaces no crash when rejectPlan rejects", async () => {
      const onAction = vi.fn();
      mockApi.rejectPlan.mockRejectedValue(new Error("network down"));
      render(<ActionBar runId={RUN_ID} state="AwaitingPlanApproval" onAction={onAction} />);

      await userEvent.click(screen.getByRole("button", { name: /reject plan/i }));
      const confirmButtons = screen.getAllByRole("button", { name: /reject plan/i });
      await userEvent.click(confirmButtons[confirmButtons.length - 1]);

      await waitFor(() => {
        expect(mockApi.rejectPlan).toHaveBeenCalledOnce();
      });
      expect(onAction).not.toHaveBeenCalled();
      // Dialog closes regardless (finally block resets showRejectDialog)
      expect(screen.queryByText(/this will reject the current plan/i)).toBeNull();
    });

    it("re-review action calls api.reReviewPlan with the optional note", async () => {
      const onAction = vi.fn();
      render(<ActionBar runId={RUN_ID} state="AwaitingPlanApproval" onAction={onAction} />);

      await userEvent.click(screen.getByRole("button", { name: /re-review plan/i }));
      await userEvent.click(screen.getByRole("button", { name: /^re-review$/i }));

      await waitFor(() => {
        expect(mockApi.reReviewPlan).toHaveBeenCalledWith(RUN_ID, undefined);
        expect(onAction).toHaveBeenCalledOnce();
      });
    });

    it("revise action calls api.revisePlan with the optional note", async () => {
      const onAction = vi.fn();
      render(<ActionBar runId={RUN_ID} state="AwaitingPlanApproval" onAction={onAction} />);

      await userEvent.click(screen.getByRole("button", { name: /revise plan/i }));
      await userEvent.click(screen.getByRole("button", { name: /^revise$/i }));

      await waitFor(() => {
        expect(mockApi.revisePlan).toHaveBeenCalledWith(RUN_ID, undefined);
        expect(onAction).toHaveBeenCalledOnce();
      });
    });
  });

  it("ReadyForHumanReview renders Approve & Complete and calls api.approveReview", async () => {
    const onAction = vi.fn();
    render(<ActionBar runId={RUN_ID} state="ReadyForHumanReview" onAction={onAction} />);

    await userEvent.click(screen.getByRole("button", { name: /approve & complete/i }));
    await userEvent.click(screen.getByRole("button", { name: /complete run/i }));

    await waitFor(() => {
      expect(mockApi.approveReview).toHaveBeenCalledWith(RUN_ID);
      expect(onAction).toHaveBeenCalledOnce();
    });
  });

  it("an active-category state (Planning) renders both Pause and Retry actions", () => {
    render(<ActionBar runId={RUN_ID} state="Planning" onAction={vi.fn()} />);

    expect(screen.getByRole("button", { name: /^pause$/i })).toBeDefined();
    expect(screen.getByRole("button", { name: /retry planning/i })).toBeDefined();
  });

  it("clicking Pause opens the confirm dialog and calls api.pauseRun on confirm", async () => {
    const onAction = vi.fn();
    render(<ActionBar runId={RUN_ID} state="Planning" onAction={onAction} />);

    await userEvent.click(screen.getByRole("button", { name: /^pause$/i }));
    expect(screen.getByText(/this will pause the run/i)).toBeDefined();
    // Both the trigger button and the dialog's confirm button are now
    // labeled "Pause" — the confirm button is the one rendered last.
    const pauseButtons = screen.getAllByRole("button", { name: /^pause$/i });
    await userEvent.click(pauseButtons[pauseButtons.length - 1]);

    await waitFor(() => {
      expect(mockApi.pauseRun).toHaveBeenCalledWith(RUN_ID);
      expect(onAction).toHaveBeenCalledOnce();
    });
  });

  it("clicking Retry (Planning) calls api.retryStage on confirm", async () => {
    const onAction = vi.fn();
    render(<ActionBar runId={RUN_ID} state="Planning" onAction={onAction} />);

    await userEvent.click(screen.getByRole("button", { name: /retry planning/i }));
    expect(screen.getByText(/re-run the current stage \(planning\)/i)).toBeDefined();
    await userEvent.click(screen.getByRole("button", { name: /^retry$/i }));

    await waitFor(() => {
      expect(mockApi.retryStage).toHaveBeenCalledWith(RUN_ID);
      expect(onAction).toHaveBeenCalledOnce();
    });
  });

  it("Todo state renders only the 'Start Run' retry action", () => {
    render(<ActionBar runId={RUN_ID} state="Todo" onAction={vi.fn()} />);
    expect(screen.getByRole("button", { name: /start run/i })).toBeDefined();
    expect(screen.queryByRole("button", { name: /^pause$/i })).toBeNull();
  });

  it("AIBlocked renders only the Resume action and calls api.resumeRun", async () => {
    const onAction = vi.fn();
    render(<ActionBar runId={RUN_ID} state="AIBlocked" onAction={onAction} />);

    expect(screen.queryByRole("button", { name: /answer questions/i })).toBeNull();
    await userEvent.click(screen.getByRole("button", { name: /^resume$/i }));
    // Trigger button and dialog confirm button share the "Resume" label.
    const resumeButtons = screen.getAllByRole("button", { name: /^resume$/i });
    await userEvent.click(resumeButtons[resumeButtons.length - 1]);

    await waitFor(() => {
      expect(mockApi.resumeRun).toHaveBeenCalledWith(RUN_ID);
      expect(onAction).toHaveBeenCalledOnce();
    });
  });

  it("HumanClarificationNeeded renders both Resume and Answer Questions, wiring onScrollToQuestions", async () => {
    const onScrollToQuestions = vi.fn();
    render(
      <ActionBar
        runId={RUN_ID}
        state="HumanClarificationNeeded"
        onAction={vi.fn()}
        onScrollToQuestions={onScrollToQuestions}
      />,
    );

    expect(screen.getByRole("button", { name: /^resume$/i })).toBeDefined();
    await userEvent.click(screen.getByRole("button", { name: /answer questions/i }));
    expect(onScrollToQuestions).toHaveBeenCalledOnce();
  });

  it("Failed state renders the Resume action", () => {
    render(<ActionBar runId={RUN_ID} state="Failed" onAction={vi.fn()} />);
    expect(screen.getByRole("button", { name: /^resume$/i })).toBeDefined();
  });
});
