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

  it("renders nothing when the state has no applicable actions", () => {
    const { container } = render(
      <ActionBar runId={RUN_ID} state="Done" onAction={vi.fn()} />,
    );
    expect(container.firstChild).toBeNull();
  });

  it("Approve Plan opens a confirm dialog and calls api.approvePlan + onAction on confirm", async () => {
    mockApi.approvePlan.mockResolvedValue({ ok: true, state: "Implementing" });
    const onAction = vi.fn();
    render(
      <ActionBar runId={RUN_ID} state="AwaitingPlanApproval" onAction={onAction} />,
    );

    await userEvent.click(screen.getByRole("button", { name: /^approve plan$/i }));

    expect(screen.getByText("Approve Plan", { selector: "h3" })).toBeDefined();
    const confirmBtn = screen.getByRole("button", { name: /approve & start/i });
    await userEvent.click(confirmBtn);

    await waitFor(() => {
      expect(mockApi.approvePlan).toHaveBeenCalledWith(RUN_ID, undefined);
      expect(onAction).toHaveBeenCalledOnce();
    });
  });

  it("Approve Plan passes trimmed notes text to the API", async () => {
    mockApi.approvePlan.mockResolvedValue({ ok: true, state: "Implementing" });
    render(<ActionBar runId={RUN_ID} state="AwaitingPlanApproval" onAction={vi.fn()} />);

    await userEvent.click(screen.getByRole("button", { name: /^approve plan$/i }));
    const textarea = screen.getByPlaceholderText(/extra context/i);
    await userEvent.type(textarea, "  watch the edge cases  ");
    await userEvent.click(screen.getByRole("button", { name: /approve & start/i }));

    await waitFor(() => {
      expect(mockApi.approvePlan).toHaveBeenCalledWith(RUN_ID, "watch the edge cases");
    });
  });

  it("dialog Cancel closes without calling the API", async () => {
    render(<ActionBar runId={RUN_ID} state="AwaitingPlanApproval" onAction={vi.fn()} />);

    await userEvent.click(screen.getByRole("button", { name: /^approve plan$/i }));
    expect(screen.getByText("Approve Plan", { selector: "h3" })).toBeDefined();

    await userEvent.click(screen.getByRole("button", { name: /^cancel$/i }));

    expect(screen.queryByText("Approve Plan", { selector: "h3" })).toBeNull();
    expect(mockApi.approvePlan).not.toHaveBeenCalled();
  });

  it("does not call onAction when the confirmed action rejects", async () => {
    mockApi.approvePlan.mockRejectedValue(new Error("boom"));
    const onAction = vi.fn();
    render(<ActionBar runId={RUN_ID} state="AwaitingPlanApproval" onAction={onAction} />);

    await userEvent.click(screen.getByRole("button", { name: /^approve plan$/i }));
    await userEvent.click(screen.getByRole("button", { name: /approve & start/i }));

    await waitFor(() => {
      expect(mockApi.approvePlan).toHaveBeenCalledOnce();
    });
    expect(onAction).not.toHaveBeenCalled();
    // Dialog closes even on failure
    expect(screen.queryByText("Approve Plan", { selector: "h3" })).toBeNull();
  });

  it("Reject Plan opens the custom reject dialog, defaults to iterate mode, and submits trimmed feedback", async () => {
    mockApi.rejectPlan.mockResolvedValue({ ok: true, state: "Planning" });
    const onAction = vi.fn();
    render(<ActionBar runId={RUN_ID} state="AwaitingPlanApproval" onAction={onAction} />);

    await userEvent.click(screen.getByRole("button", { name: /^reject plan$/i }));
    expect(screen.getByText("This will reject the current plan and send it back for re-planning.")).toBeDefined();

    const feedback = screen.getByPlaceholderText(/describe what should change/i);
    await userEvent.type(feedback, "  needs more detail  ");

    // Submit via the dialog's own Reject Plan button (there are two matches:
    // the trigger and the dialog submit — pick the last one rendered).
    const rejectButtons = screen.getAllByRole("button", { name: /^reject plan$/i });
    await userEvent.click(rejectButtons[rejectButtons.length - 1]!);

    await waitFor(() => {
      expect(mockApi.rejectPlan).toHaveBeenCalledWith(RUN_ID, "needs more detail", "iterate");
      expect(onAction).toHaveBeenCalledOnce();
    });
  });

  it("Reject Plan can switch to fresh mode before submitting", async () => {
    mockApi.rejectPlan.mockResolvedValue({ ok: true, state: "Planning" });
    render(<ActionBar runId={RUN_ID} state="AwaitingPlanApproval" onAction={vi.fn()} />);

    await userEvent.click(screen.getByRole("button", { name: /^reject plan$/i }));
    await userEvent.click(screen.getByText("Start fresh"));

    const rejectButtons = screen.getAllByRole("button", { name: /^reject plan$/i });
    await userEvent.click(rejectButtons[rejectButtons.length - 1]!);

    await waitFor(() => {
      expect(mockApi.rejectPlan).toHaveBeenCalledWith(RUN_ID, undefined, "fresh");
    });
  });

  it("Reject Plan can switch to fresh then back to iterate mode before submitting", async () => {
    mockApi.rejectPlan.mockResolvedValue({ ok: true, state: "Planning" });
    render(<ActionBar runId={RUN_ID} state="AwaitingPlanApproval" onAction={vi.fn()} />);

    await userEvent.click(screen.getByRole("button", { name: /^reject plan$/i }));
    await userEvent.click(screen.getByText("Start fresh"));
    await userEvent.click(screen.getByText("Revise plan"));

    const rejectButtons = screen.getAllByRole("button", { name: /^reject plan$/i });
    await userEvent.click(rejectButtons[rejectButtons.length - 1]!);

    await waitFor(() => {
      expect(mockApi.rejectPlan).toHaveBeenCalledWith(RUN_ID, undefined, "iterate");
    });
  });

  it("Reject Plan dialog Cancel resets state without calling the API", async () => {
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

  it("Re-review Plan and Revise Plan buttons render for AwaitingPlanApproval and call their APIs", async () => {
    mockApi.reReviewPlan.mockResolvedValue({ ok: true, runId: RUN_ID });
    mockApi.revisePlan.mockResolvedValue({ ok: true, runId: RUN_ID });
    render(<ActionBar runId={RUN_ID} state="AwaitingPlanApproval" onAction={vi.fn()} />);

    await userEvent.click(screen.getByRole("button", { name: /re-review plan/i }));
    await userEvent.click(screen.getByRole("button", { name: /^re-review$/i }));
    await waitFor(() => {
      expect(mockApi.reReviewPlan).toHaveBeenCalledWith(RUN_ID, undefined);
    });

    await userEvent.click(screen.getByRole("button", { name: /^revise plan$/i }));
    await userEvent.click(screen.getByRole("button", { name: /^revise$/i }));
    await waitFor(() => {
      expect(mockApi.revisePlan).toHaveBeenCalledWith(RUN_ID, undefined);
    });
  });

  it("Answer Questions button appears for HumanClarificationNeeded and triggers onScrollToQuestions", async () => {
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

  it("Resume button appears for HumanClarificationNeeded and calls api.resumeRun", async () => {
    mockApi.resumeRun.mockResolvedValue({ ok: true });
    const onAction = vi.fn();
    render(<ActionBar runId={RUN_ID} state="HumanClarificationNeeded" onAction={onAction} />);

    await userEvent.click(screen.getByRole("button", { name: /^resume$/i }));
    const resumeButtons = screen.getAllByRole("button", { name: /^resume$/i });
    await userEvent.click(resumeButtons[resumeButtons.length - 1]!);

    await waitFor(() => {
      expect(mockApi.resumeRun).toHaveBeenCalledWith(RUN_ID);
      expect(onAction).toHaveBeenCalledOnce();
    });
  });

  it("Answer Optional Questions button appears when hasOptionalQuestions is true", async () => {
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

  it("does not show Answer Optional Questions when hasOptionalQuestions is false", () => {
    render(<ActionBar runId={RUN_ID} state="AwaitingPlanApproval" onAction={vi.fn()} />);
    expect(screen.queryByRole("button", { name: /answer optional questions/i })).toBeNull();
  });

  it("Approve & Complete appears for ReadyForHumanReview and calls api.approveReview with no note", async () => {
    mockApi.approveReview.mockResolvedValue({ ok: true, state: "Done" });
    const onAction = vi.fn();
    render(<ActionBar runId={RUN_ID} state="ReadyForHumanReview" onAction={onAction} />);

    await userEvent.click(screen.getByRole("button", { name: /approve & complete/i }));
    await userEvent.click(screen.getByRole("button", { name: /complete run/i }));

    await waitFor(() => {
      expect(mockApi.approveReview).toHaveBeenCalledWith(RUN_ID);
      expect(onAction).toHaveBeenCalledOnce();
    });
  });

  it("Pause button appears for active-category states and calls api.pauseRun", async () => {
    mockApi.pauseRun.mockResolvedValue({ ok: true });
    const onAction = vi.fn();
    render(<ActionBar runId={RUN_ID} state="Implementing" onAction={onAction} />);

    await userEvent.click(screen.getByRole("button", { name: /^pause$/i }));
    const pauseButtons = screen.getAllByRole("button", { name: /^pause$/i });
    await userEvent.click(pauseButtons[pauseButtons.length - 1]!);

    await waitFor(() => {
      expect(mockApi.pauseRun).toHaveBeenCalledWith(RUN_ID);
      expect(onAction).toHaveBeenCalledOnce();
    });
  });

  it("Resume button appears for AIBlocked and calls api.resumeRun", async () => {
    mockApi.resumeRun.mockResolvedValue({ ok: true });
    render(<ActionBar runId={RUN_ID} state="AIBlocked" onAction={vi.fn()} />);

    await userEvent.click(screen.getByRole("button", { name: /^resume$/i }));
    expect(screen.getByText("This will reset the run back to the start. It will begin re-planning.")).toBeDefined();
  });

  it("Resume button appears for Failed state", () => {
    render(<ActionBar runId={RUN_ID} state="Failed" onAction={vi.fn()} />);
    expect(screen.getByRole("button", { name: /^resume$/i })).toBeDefined();
  });

  it.each([
    ["Todo", "Start Run"],
    ["Planning", "Retry Planning"],
    ["PlanRevision", "Retry Plan Revision"],
    ["PlanReview", "Retry Plan Review"],
    ["Implementing", "Retry Execution"],
    ["AIReview", "Retry Code Review"],
    ["AddressingReview", "Retry Remediation"],
  ])("shows the correct retry label for state %s", async (state, label) => {
    render(<ActionBar runId={RUN_ID} state={state} onAction={vi.fn()} />);
    expect(screen.getByRole("button", { name: new RegExp(`^${label}$`, "i") })).toBeDefined();
  });

  it("Retry action calls api.retryStage and onAction on confirm", async () => {
    mockApi.retryStage.mockResolvedValue({ ok: true, state: "Planning", retrying: true });
    const onAction = vi.fn();
    render(<ActionBar runId={RUN_ID} state="Planning" onAction={onAction} />);

    await userEvent.click(screen.getByRole("button", { name: /retry planning/i }));
    await userEvent.click(screen.getByRole("button", { name: /^retry$/i }));

    await waitFor(() => {
      expect(mockApi.retryStage).toHaveBeenCalledWith(RUN_ID);
      expect(onAction).toHaveBeenCalledOnce();
    });
  });
});
