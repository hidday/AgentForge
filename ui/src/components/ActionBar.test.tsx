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

describe("ActionBar", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    for (const fn of Object.values(mockApi)) fn.mockResolvedValue({ ok: true });
  });

  it("renders nothing for a state with no available actions", () => {
    const { container } = render(
      <ActionBar runId="run-1" state="Done" onAction={vi.fn()} />,
    );
    expect(container.firstChild).toBeNull();
  });

  it("renders Approve Plan and Reject Plan buttons in AwaitingPlanApproval, and calls approvePlan + onAction on approve confirm", async () => {
    const onAction = vi.fn();
    render(
      <ActionBar runId="run-1" state="AwaitingPlanApproval" onAction={onAction} />,
    );

    expect(screen.getByRole("button", { name: /Approve Plan/i })).toBeDefined();
    expect(screen.getByRole("button", { name: /Reject Plan/i })).toBeDefined();
    expect(screen.getByRole("button", { name: /Re-review Plan/i })).toBeDefined();
    expect(screen.getByRole("button", { name: /Revise Plan/i })).toBeDefined();

    await userEvent.click(screen.getByRole("button", { name: /Approve Plan/i }));

    // Confirm dialog appears
    expect(screen.getByRole("heading", { name: "Approve Plan" })).toBeDefined();
    const confirmBtn = screen.getByRole("button", { name: "Approve & Start" });
    await userEvent.click(confirmBtn);

    await waitFor(() => {
      expect(mockApi.approvePlan).toHaveBeenCalledWith("run-1", undefined);
      expect(onAction).toHaveBeenCalledOnce();
    });
  });

  it("shows Answer Optional Questions button when hasOptionalQuestions is true and calls onScrollToQuestions", async () => {
    const onScrollToQuestions = vi.fn();
    render(
      <ActionBar
        runId="run-1"
        state="AwaitingPlanApproval"
        onAction={vi.fn()}
        onScrollToQuestions={onScrollToQuestions}
        hasOptionalQuestions={true}
      />,
    );

    const btn = screen.getByRole("button", { name: /Answer Optional Questions/i });
    await userEvent.click(btn);
    expect(onScrollToQuestions).toHaveBeenCalledOnce();
  });

  it("opens the custom reject dialog, allows switching modes, and calls rejectPlan with trimmed context and mode", async () => {
    const onAction = vi.fn();
    render(
      <ActionBar runId="run-1" state="AwaitingPlanApproval" onAction={onAction} />,
    );

    await userEvent.click(screen.getByRole("button", { name: /Reject Plan/i }));

    // Custom dialog with mode toggle appears
    expect(screen.getByText("Start fresh")).toBeDefined();
    await userEvent.click(screen.getByText("Start fresh"));
    // Switch back to the default "iterate" mode to exercise both toggle handlers.
    await userEvent.click(screen.getByText("Revise plan"));
    // ...then back to "fresh" for the actual submission under test.
    await userEvent.click(screen.getByText("Start fresh"));

    const textarea = screen.getByPlaceholderText(/Optional: describe what should change/i);
    await userEvent.type(textarea, "  please redo the db step  ");

    // There are two "Reject Plan" buttons now (the trigger, hidden behind dialog, and
    // the dialog's own submit button) — grab the submit button specifically.
    const buttons = screen.getAllByRole("button", { name: "Reject Plan" });
    const submitBtn = buttons[buttons.length - 1];
    await userEvent.click(submitBtn);

    await waitFor(() => {
      expect(mockApi.rejectPlan).toHaveBeenCalledWith(
        "run-1",
        "please redo the db step",
        "fresh",
      );
      expect(onAction).toHaveBeenCalledOnce();
    });
  });

  it("cancels the reject dialog without calling rejectPlan", async () => {
    render(<ActionBar runId="run-1" state="AwaitingPlanApproval" onAction={vi.fn()} />);

    await userEvent.click(screen.getByRole("button", { name: /Reject Plan/i }));
    expect(screen.getByText("This will reject the current plan and send it back for re-planning.")).toBeDefined();

    await userEvent.click(screen.getByRole("button", { name: "Cancel" }));

    expect(mockApi.rejectPlan).not.toHaveBeenCalled();
    expect(
      screen.queryByText("This will reject the current plan and send it back for re-planning."),
    ).toBeNull();
  });

  it("opens the Re-review Plan dialog and calls reReviewPlan on confirm", async () => {
    const onAction = vi.fn();
    render(<ActionBar runId="run-1" state="AwaitingPlanApproval" onAction={onAction} />);

    await userEvent.click(screen.getByRole("button", { name: /Re-review Plan/i }));
    expect(screen.getByRole("heading", { name: "Re-review Plan" })).toBeDefined();

    await userEvent.click(screen.getByRole("button", { name: "Re-review" }));

    await waitFor(() => {
      expect(mockApi.reReviewPlan).toHaveBeenCalledWith("run-1", undefined);
      expect(onAction).toHaveBeenCalledOnce();
    });
  });

  it("opens the Revise Plan dialog and calls revisePlan on confirm", async () => {
    const onAction = vi.fn();
    render(<ActionBar runId="run-1" state="AwaitingPlanApproval" onAction={onAction} />);

    await userEvent.click(screen.getByRole("button", { name: /Revise Plan/i }));
    await userEvent.click(screen.getByRole("button", { name: "Revise" }));

    await waitFor(() => {
      expect(mockApi.revisePlan).toHaveBeenCalledWith("run-1", undefined);
      expect(onAction).toHaveBeenCalledOnce();
    });
  });

  it("shows Answer Questions button in HumanClarificationNeeded and Resume action", async () => {
    const onScrollToQuestions = vi.fn();
    const onAction = vi.fn();
    render(
      <ActionBar
        runId="run-1"
        state="HumanClarificationNeeded"
        onAction={onAction}
        onScrollToQuestions={onScrollToQuestions}
      />,
    );

    const answerBtn = screen.getByRole("button", { name: /^Answer Questions$/i });
    await userEvent.click(answerBtn);
    expect(onScrollToQuestions).toHaveBeenCalledOnce();

    const resumeBtn = screen.getByRole("button", { name: /Resume/i });
    await userEvent.click(resumeBtn);
    // Trigger button and dialog confirm button share the "Resume" label —
    // the dialog's confirm button is the last one rendered in the DOM.
    const resumeButtons = screen.getAllByRole("button", { name: "Resume" });
    await userEvent.click(resumeButtons[resumeButtons.length - 1]);

    await waitFor(() => {
      expect(mockApi.resumeRun).toHaveBeenCalledWith("run-1");
      expect(onAction).toHaveBeenCalledOnce();
    });
  });

  it("shows Resume action for AIBlocked and Failed states", () => {
    const { rerender } = render(
      <ActionBar runId="run-1" state="AIBlocked" onAction={vi.fn()} />,
    );
    expect(screen.getByRole("button", { name: /Resume/i })).toBeDefined();

    rerender(<ActionBar runId="run-1" state="Failed" onAction={vi.fn()} />);
    expect(screen.getByRole("button", { name: /Resume/i })).toBeDefined();
  });

  it("shows Pause for active-category states and calls pauseRun", async () => {
    const onAction = vi.fn();
    render(<ActionBar runId="run-1" state="Implementing" onAction={onAction} />);

    const pauseBtn = screen.getByRole("button", { name: /Pause/i });
    await userEvent.click(pauseBtn);
    // Trigger button and dialog confirm button share the "Pause" label —
    // the dialog's confirm button is the last one rendered in the DOM.
    const pauseButtons = screen.getAllByRole("button", { name: "Pause" });
    await userEvent.click(pauseButtons[pauseButtons.length - 1]);

    await waitFor(() => {
      expect(mockApi.pauseRun).toHaveBeenCalledWith("run-1");
      expect(onAction).toHaveBeenCalledOnce();
    });
  });

  it.each([
    ["Todo", "Start Run"],
    ["Planning", "Retry Planning"],
    ["PlanRevision", "Retry Plan Revision"],
    ["PlanReview", "Retry Plan Review"],
    ["Implementing", "Retry Execution"],
    ["AIReview", "Retry Code Review"],
    ["AddressingReview", "Retry Remediation"],
  ])("shows correct retry label for state %s", (state, label) => {
    render(<ActionBar runId="run-1" state={state} onAction={vi.fn()} />);
    expect(screen.getByRole("button", { name: new RegExp(label, "i") })).toBeDefined();
  });

  it("calls retryStage with the current run id when a retry action is confirmed", async () => {
    const onAction = vi.fn();
    render(<ActionBar runId="run-42" state="Planning" onAction={onAction} />);

    await userEvent.click(screen.getByRole("button", { name: /Retry Planning/i }));
    await userEvent.click(screen.getByRole("button", { name: "Retry" }));

    await waitFor(() => {
      expect(mockApi.retryStage).toHaveBeenCalledWith("run-42");
      expect(onAction).toHaveBeenCalledOnce();
    });
  });

  it("shows Approve & Complete in ReadyForHumanReview and calls approveReview", async () => {
    const onAction = vi.fn();
    render(<ActionBar runId="run-1" state="ReadyForHumanReview" onAction={onAction} />);

    await userEvent.click(screen.getByRole("button", { name: /Approve & Complete/i }));
    await userEvent.click(screen.getByRole("button", { name: "Complete Run" }));

    await waitFor(() => {
      expect(mockApi.approveReview).toHaveBeenCalledWith("run-1");
      expect(onAction).toHaveBeenCalledOnce();
    });
  });

  it("dismisses the confirm dialog on cancel without invoking the API", async () => {
    render(<ActionBar runId="run-1" state="ReadyForHumanReview" onAction={vi.fn()} />);

    await userEvent.click(screen.getByRole("button", { name: /Approve & Complete/i }));
    await userEvent.click(screen.getByRole("button", { name: "Cancel" }));

    expect(mockApi.approveReview).not.toHaveBeenCalled();
    expect(screen.queryByRole("heading", { name: "Approve & Complete" })).toBeNull();
  });

  it("shows loading state and swallows errors from a failed confirm action", async () => {
    let resolveFn: (v: unknown) => void = () => {};
    mockApi.approveReview.mockReturnValue(
      new Promise((_resolve, reject) => {
        resolveFn = reject;
      }),
    );
    const onAction = vi.fn();

    render(<ActionBar runId="run-1" state="ReadyForHumanReview" onAction={onAction} />);

    await userEvent.click(screen.getByRole("button", { name: /Approve & Complete/i }));
    await userEvent.click(screen.getByRole("button", { name: "Complete Run" }));

    // While pending, the dialog shows the loading state
    await waitFor(() => {
      expect(screen.getByText("Working...")).toBeDefined();
    });

    resolveFn(new Error("boom"));

    // Error is swallowed; onAction is never called and dialog closes without throwing
    await waitFor(() => {
      expect(screen.queryByRole("heading", { name: "Approve & Complete" })).toBeNull();
    });
    expect(onAction).not.toHaveBeenCalled();
  });
});
