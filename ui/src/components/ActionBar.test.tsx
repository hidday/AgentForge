import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

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

import { ActionBar } from "./ActionBar.tsx";
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
    for (const fn of Object.values(mockApi)) fn.mockResolvedValue({ ok: true });
  });

  it("renders nothing for a state with no applicable actions", () => {
    const { container } = render(
      <ActionBar runId={RUN_ID} state="Done" onAction={vi.fn()} />,
    );
    expect(container.innerHTML).toBe("");
  });

  it("shows Start Run for Todo (a RETRY_LABELS state) and calls retryStage on confirm", async () => {
    const onAction = vi.fn();
    render(<ActionBar runId={RUN_ID} state="Todo" onAction={onAction} />);

    const startBtn = screen.getByRole("button", { name: /start run/i });
    await userEvent.click(startBtn);

    // Confirm dialog opens with the matching title (heading, distinct from the trigger button)
    expect(screen.getByRole("heading", { name: "Start Run" })).toBeDefined();
    await userEvent.click(screen.getByRole("button", { name: "Retry" }));

    await waitFor(() => {
      expect(mockApi.retryStage).toHaveBeenCalledWith(RUN_ID);
    });
    expect(onAction).toHaveBeenCalledTimes(1);
  });

  it("shows Approve Plan and Reject Plan for AwaitingPlanApproval, plus Re-review and Revise", () => {
    render(
      <ActionBar runId={RUN_ID} state="AwaitingPlanApproval" onAction={vi.fn()} />,
    );
    expect(screen.getByRole("button", { name: /approve plan/i })).toBeDefined();
    expect(screen.getByRole("button", { name: /reject plan/i })).toBeDefined();
    expect(screen.getByRole("button", { name: /re-review plan/i })).toBeDefined();
    expect(screen.getByRole("button", { name: /revise plan/i })).toBeDefined();
  });

  it("shows the optional-questions button only when hasOptionalQuestions is true, and it calls onScrollToQuestions", async () => {
    const onScrollToQuestions = vi.fn();
    const { rerender } = render(
      <ActionBar
        runId={RUN_ID}
        state="AwaitingPlanApproval"
        onAction={vi.fn()}
        hasOptionalQuestions={false}
        onScrollToQuestions={onScrollToQuestions}
      />,
    );
    expect(screen.queryByRole("button", { name: /answer optional questions/i })).toBeNull();

    rerender(
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
    expect(onScrollToQuestions).toHaveBeenCalledTimes(1);
  });

  it("Approve Plan opens a dialog with a notes field and calls approvePlan with the trimmed note", async () => {
    const onAction = vi.fn();
    render(
      <ActionBar runId={RUN_ID} state="AwaitingPlanApproval" onAction={onAction} />,
    );
    await userEvent.click(screen.getByRole("button", { name: /approve plan/i }));

    const textarea = screen.getByPlaceholderText(/extra context/i);
    await userEvent.type(textarea, "  watch out for X  ");
    await userEvent.click(screen.getByRole("button", { name: "Approve & Start" }));

    await waitFor(() => {
      expect(mockApi.approvePlan).toHaveBeenCalledWith(RUN_ID, "watch out for X");
    });
    expect(onAction).toHaveBeenCalledTimes(1);
  });

  it("Re-review Plan opens a dialog and calls reReviewPlan with the note", async () => {
    const onAction = vi.fn();
    render(
      <ActionBar runId={RUN_ID} state="AwaitingPlanApproval" onAction={onAction} />,
    );
    await userEvent.click(screen.getByRole("button", { name: /re-review plan/i }));
    expect(screen.getByRole("heading", { name: "Re-review Plan" })).toBeDefined();
    await userEvent.click(screen.getByRole("button", { name: "Re-review" }));

    await waitFor(() => {
      expect(mockApi.reReviewPlan).toHaveBeenCalledWith(RUN_ID, undefined);
    });
    expect(onAction).toHaveBeenCalledTimes(1);
  });

  it("Revise Plan opens a dialog and calls revisePlan with the note", async () => {
    const onAction = vi.fn();
    render(
      <ActionBar runId={RUN_ID} state="AwaitingPlanApproval" onAction={onAction} />,
    );
    await userEvent.click(screen.getByRole("button", { name: /revise plan/i }));
    const textarea = screen.getByPlaceholderText(/tighten the rollout step/i);
    await userEvent.type(textarea, "expand tests");
    await userEvent.click(screen.getByRole("button", { name: "Revise" }));

    await waitFor(() => {
      expect(mockApi.revisePlan).toHaveBeenCalledWith(RUN_ID, "expand tests");
    });
    expect(onAction).toHaveBeenCalledTimes(1);
  });

  it("Reject Plan opens the custom reject dialog (not the generic ConfirmDialog) with iterate as the default mode", async () => {
    render(
      <ActionBar runId={RUN_ID} state="AwaitingPlanApproval" onAction={vi.fn()} />,
    );
    await userEvent.click(screen.getByRole("button", { name: /^reject plan$/i }));

    expect(
      screen.getByText("This will reject the current plan and send it back for re-planning."),
    ).toBeDefined();
    // "Revise plan" (lowercase p) is the mode-toggle button, distinct from the
    // "Revise Plan" action button that is also still present behind the dialog.
    const iterateBtn = screen.getByText("Revise plan").closest("button") as HTMLButtonElement;
    expect(iterateBtn.className).toContain("bg-accent");
    const freshBtn = screen.getByText("Start fresh").closest("button") as HTMLButtonElement;
    expect(freshBtn.className).not.toContain("bg-accent");
  });

  it("Reject Plan confirm sends the trimmed feedback and selected mode ('iterate' by default)", async () => {
    const onAction = vi.fn();
    render(
      <ActionBar runId={RUN_ID} state="AwaitingPlanApproval" onAction={onAction} />,
    );
    await userEvent.click(screen.getByRole("button", { name: /^reject plan$/i }));

    const textarea = screen.getByPlaceholderText(/describe what should change/i);
    await userEvent.type(textarea, "  needs more detail  ");

    // There are now two "Reject Plan" buttons in the DOM (the trigger, hidden behind the
    // dialog overlay, and the dialog's confirm button) - get all and click the last (confirm).
    const rejectButtons = screen.getAllByRole("button", { name: /^reject plan$/i });
    await userEvent.click(rejectButtons[rejectButtons.length - 1]);

    await waitFor(() => {
      expect(mockApi.rejectPlan).toHaveBeenCalledWith(RUN_ID, "needs more detail", "iterate");
    });
    expect(onAction).toHaveBeenCalledTimes(1);
  });

  it("Reject Plan confirm sends mode 'fresh' after toggling to Start fresh, and undefined feedback when left blank", async () => {
    const onAction = vi.fn();
    render(
      <ActionBar runId={RUN_ID} state="AwaitingPlanApproval" onAction={onAction} />,
    );
    await userEvent.click(screen.getByRole("button", { name: /^reject plan$/i }));

    await userEvent.click(screen.getByRole("button", { name: /start fresh/i }));
    const startFreshBtn = screen
      .getAllByText("Start fresh")
      .map((el) => el.closest("button"))
      .find((b) => b) as HTMLButtonElement;
    expect(startFreshBtn.className).toContain("bg-accent");

    const rejectButtons = screen.getAllByRole("button", { name: /^reject plan$/i });
    await userEvent.click(rejectButtons[rejectButtons.length - 1]);

    await waitFor(() => {
      expect(mockApi.rejectPlan).toHaveBeenCalledWith(RUN_ID, undefined, "fresh");
    });
    expect(onAction).toHaveBeenCalledTimes(1);
  });

  it("Reject Plan mode toggle switches back to 'iterate' after selecting 'fresh'", async () => {
    const onAction = vi.fn();
    render(
      <ActionBar runId={RUN_ID} state="AwaitingPlanApproval" onAction={onAction} />,
    );
    await userEvent.click(screen.getByRole("button", { name: /^reject plan$/i }));

    await userEvent.click(screen.getByRole("button", { name: /start fresh/i }));
    await userEvent.click(screen.getByText("Revise plan").closest("button") as HTMLButtonElement);

    const iterateBtn = screen.getByText("Revise plan").closest("button") as HTMLButtonElement;
    expect(iterateBtn.className).toContain("bg-accent");

    const rejectButtons = screen.getAllByRole("button", { name: /^reject plan$/i });
    await userEvent.click(rejectButtons[rejectButtons.length - 1]);

    await waitFor(() => {
      expect(mockApi.rejectPlan).toHaveBeenCalledWith(RUN_ID, undefined, "iterate");
    });
    expect(onAction).toHaveBeenCalledTimes(1);
  });

  it("Reject Plan cancel closes the dialog without calling rejectPlan", async () => {
    render(
      <ActionBar runId={RUN_ID} state="AwaitingPlanApproval" onAction={vi.fn()} />,
    );
    await userEvent.click(screen.getByRole("button", { name: /^reject plan$/i }));
    await userEvent.click(screen.getByRole("button", { name: "Cancel" }));

    expect(
      screen.queryByText("This will reject the current plan and send it back for re-planning."),
    ).toBeNull();
    expect(mockApi.rejectPlan).not.toHaveBeenCalled();
  });

  it("Approve & Complete for ReadyForHumanReview calls approveReview with no notes field shown", async () => {
    const onAction = vi.fn();
    render(
      <ActionBar runId={RUN_ID} state="ReadyForHumanReview" onAction={onAction} />,
    );
    await userEvent.click(screen.getByRole("button", { name: /approve & complete/i }));
    expect(screen.queryByRole("textbox")).toBeNull();
    await userEvent.click(screen.getByRole("button", { name: "Complete Run" }));

    await waitFor(() => {
      expect(mockApi.approveReview).toHaveBeenCalledWith(RUN_ID);
    });
    expect(onAction).toHaveBeenCalledTimes(1);
  });

  it("shows Pause for an active-category state and calls pauseRun on confirm", async () => {
    const onAction = vi.fn();
    render(<ActionBar runId={RUN_ID} state="Planning" onAction={onAction} />);
    await userEvent.click(screen.getByRole("button", { name: /pause/i }));
    // Both the trigger and the dialog's confirm button are labeled "Pause";
    // the confirm button is rendered last in the DOM.
    const pauseButtons = screen.getAllByRole("button", { name: "Pause" });
    await userEvent.click(pauseButtons[pauseButtons.length - 1]);

    await waitFor(() => {
      expect(mockApi.pauseRun).toHaveBeenCalledWith(RUN_ID);
    });
    expect(onAction).toHaveBeenCalledTimes(1);
  });

  it("shows both Pause and Retry Execution for Implementing (active category + retry-eligible state)", () => {
    render(<ActionBar runId={RUN_ID} state="Implementing" onAction={vi.fn()} />);
    expect(screen.getByRole("button", { name: /pause/i })).toBeDefined();
    expect(screen.getByRole("button", { name: /retry execution/i })).toBeDefined();
  });

  it("shows Resume for AIBlocked and calls resumeRun on confirm", async () => {
    const onAction = vi.fn();
    render(<ActionBar runId={RUN_ID} state="AIBlocked" onAction={onAction} />);
    await userEvent.click(screen.getByRole("button", { name: /resume/i }));
    // Both the trigger and the dialog's confirm button are labeled "Resume";
    // the confirm button is rendered last in the DOM.
    const resumeButtons = screen.getAllByRole("button", { name: "Resume" });
    await userEvent.click(resumeButtons[resumeButtons.length - 1]);

    await waitFor(() => {
      expect(mockApi.resumeRun).toHaveBeenCalledWith(RUN_ID);
    });
    expect(onAction).toHaveBeenCalledTimes(1);
  });

  it("shows Answer Questions and Resume for HumanClarificationNeeded; Answer Questions calls onScrollToQuestions", async () => {
    const onScrollToQuestions = vi.fn();
    render(
      <ActionBar
        runId={RUN_ID}
        state="HumanClarificationNeeded"
        onAction={vi.fn()}
        onScrollToQuestions={onScrollToQuestions}
      />,
    );
    expect(screen.getByRole("button", { name: /resume/i })).toBeDefined();
    await userEvent.click(screen.getByRole("button", { name: /^answer questions$/i }));
    expect(onScrollToQuestions).toHaveBeenCalledTimes(1);
  });

  it("shows only Resume for Failed (no retry label mapping)", () => {
    render(<ActionBar runId={RUN_ID} state="Failed" onAction={vi.fn()} />);
    expect(screen.getByRole("button", { name: /resume/i })).toBeDefined();
    expect(screen.queryByRole("button", { name: /retry/i })).toBeNull();
  });

  it("uses the specific retry label and dialog title for a known retry state (PlanReview)", async () => {
    render(<ActionBar runId={RUN_ID} state="PlanReview" onAction={vi.fn()} />);
    const retryBtn = screen.getByRole("button", { name: /retry plan review/i });
    await userEvent.click(retryBtn);
    expect(screen.getByRole("heading", { name: "Retry Plan Review" })).toBeDefined();
    expect(screen.getByText(/Re-run the current stage \(PlanReview\)/)).toBeDefined();
  });

  it("closes the dialog and does not call onAction when the confirmed action rejects", async () => {
    mockApi.retryStage.mockRejectedValue(new Error("boom"));
    const onAction = vi.fn();
    render(<ActionBar runId={RUN_ID} state="Todo" onAction={onAction} />);
    await userEvent.click(screen.getByRole("button", { name: /start run/i }));
    await userEvent.click(screen.getByRole("button", { name: "Retry" }));

    await waitFor(() => {
      expect(mockApi.retryStage).toHaveBeenCalled();
    });
    // Dialog should be closed again (its confirm button, labeled "Retry" and
    // distinct from the "Start Run" trigger, is gone) and onAction never called
    await waitFor(() => {
      expect(screen.queryByRole("button", { name: "Retry" })).toBeNull();
    });
    expect(onAction).not.toHaveBeenCalled();
  });

  it("Cancel on the generic confirm dialog closes it without invoking the action", async () => {
    render(<ActionBar runId={RUN_ID} state="Todo" onAction={vi.fn()} />);
    await userEvent.click(screen.getByRole("button", { name: /start run/i }));
    await userEvent.click(screen.getByRole("button", { name: "Cancel" }));

    expect(screen.queryByText(/Re-run the current stage/)).toBeNull();
    expect(mockApi.retryStage).not.toHaveBeenCalled();
  });
});
