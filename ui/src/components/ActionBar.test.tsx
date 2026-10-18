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
    for (const fn of Object.values(mockApi)) {
      fn.mockResolvedValue({ ok: true });
    }
  });

  it("renders nothing for a state with no applicable actions", () => {
    const { container } = render(
      <ActionBar runId={RUN_ID} state="Done" onAction={vi.fn()} />,
    );
    expect(container.firstChild).toBeNull();
  });

  it("shows a Start Run button for Todo state and confirms via api.retryStage", async () => {
    const onAction = vi.fn();
    render(<ActionBar runId={RUN_ID} state="Todo" onAction={onAction} />);

    await userEvent.click(screen.getByRole("button", { name: /start run/i }));
    expect(screen.getByRole("heading", { name: "Start Run" })).toBeDefined();

    await userEvent.click(screen.getByRole("button", { name: "Retry" }));

    await waitFor(() => {
      expect(mockApi.retryStage).toHaveBeenCalledWith(RUN_ID);
      expect(onAction).toHaveBeenCalledOnce();
    });
  });

  it("shows Approve Plan and Reject Plan actions for AwaitingPlanApproval, and approves with a note", async () => {
    const onAction = vi.fn();
    render(
      <ActionBar runId={RUN_ID} state="AwaitingPlanApproval" onAction={onAction} />,
    );

    expect(screen.getByRole("button", { name: /approve plan/i })).toBeDefined();
    expect(screen.getByRole("button", { name: /reject plan/i })).toBeDefined();
    expect(screen.getByRole("button", { name: /re-review plan/i })).toBeDefined();
    expect(screen.getByRole("button", { name: /revise plan/i })).toBeDefined();

    await userEvent.click(screen.getByRole("button", { name: /approve plan/i }));

    // ConfirmDialog is now open with the Approve & Start confirm button
    const confirmBtn = screen.getByRole("button", { name: "Approve & Start" });
    const textarea = screen.getByRole("textbox");
    await userEvent.type(textarea, "watch for edge cases");
    await userEvent.click(confirmBtn);

    await waitFor(() => {
      expect(mockApi.approvePlan).toHaveBeenCalledWith(RUN_ID, "watch for edge cases");
      expect(onAction).toHaveBeenCalledOnce();
    });

    // Dialog closes after confirming
    expect(screen.queryByRole("button", { name: "Approve & Start" })).toBeNull();
  });

  it("does not show the optional-questions button unless hasOptionalQuestions is true", () => {
    render(
      <ActionBar
        runId={RUN_ID}
        state="AwaitingPlanApproval"
        onAction={vi.fn()}
        hasOptionalQuestions={false}
      />,
    );
    expect(screen.queryByRole("button", { name: /answer optional questions/i })).toBeNull();
  });

  it("shows the optional-questions button when hasOptionalQuestions is true and calls onScrollToQuestions", async () => {
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
    await userEvent.click(
      screen.getByRole("button", { name: /answer optional questions/i }),
    );
    expect(onScrollToQuestions).toHaveBeenCalledOnce();
  });

  it("opens the re-review dialog with its own notes copy and calls api.reReviewPlan", async () => {
    const onAction = vi.fn();
    render(
      <ActionBar runId={RUN_ID} state="AwaitingPlanApproval" onAction={onAction} />,
    );

    await userEvent.click(screen.getByRole("button", { name: /re-review plan/i }));
    expect(screen.getByRole("heading", { name: "Re-review Plan" })).toBeDefined();
    expect(
      screen.getByText("Notes for the plan reviewer (optional)"),
    ).toBeDefined();

    await userEvent.click(screen.getByRole("button", { name: "Re-review" }));

    await waitFor(() => {
      expect(mockApi.reReviewPlan).toHaveBeenCalledWith(RUN_ID, undefined);
      expect(onAction).toHaveBeenCalledOnce();
    });
  });

  it("opens the revise-plan dialog and calls api.revisePlan", async () => {
    const onAction = vi.fn();
    render(
      <ActionBar runId={RUN_ID} state="AwaitingPlanApproval" onAction={onAction} />,
    );

    await userEvent.click(screen.getByRole("button", { name: /revise plan/i }));
    expect(screen.getByRole("heading", { name: "Revise Plan" })).toBeDefined();

    const textarea = screen.getByRole("textbox");
    await userEvent.type(textarea, "tighten rollout");
    await userEvent.click(screen.getByRole("button", { name: "Revise" }));

    await waitFor(() => {
      expect(mockApi.revisePlan).toHaveBeenCalledWith(RUN_ID, "tighten rollout");
      expect(onAction).toHaveBeenCalledOnce();
    });
  });

  it("opens a custom Reject Plan dialog (not the generic ConfirmDialog) with mode toggle and feedback", async () => {
    const onAction = vi.fn();
    render(
      <ActionBar runId={RUN_ID} state="AwaitingPlanApproval" onAction={onAction} />,
    );

    await userEvent.click(screen.getByRole("button", { name: /reject plan/i }));

    expect(screen.getByText("Revise plan")).toBeDefined();
    expect(screen.getByText("Start fresh")).toBeDefined();
    expect(
      screen.getByText("This will reject the current plan and send it back for re-planning."),
    ).toBeDefined();

    await userEvent.click(screen.getByText("Start fresh"));
    const textarea = screen.getByPlaceholderText(
      /Optional: describe what should change/i,
    );
    await userEvent.type(textarea, "needs a rollback plan");

    // Two buttons share the name "Reject Plan": the action-bar trigger (already
    // clicked above) and the dialog's own submit button, which is the second
    // one rendered.
    const rejectButtons = screen.getAllByRole("button", { name: "Reject Plan" });
    const submitBtn = rejectButtons[rejectButtons.length - 1];
    await userEvent.click(submitBtn);

    await waitFor(() => {
      expect(mockApi.rejectPlan).toHaveBeenCalledWith(
        RUN_ID,
        "needs a rollback plan",
        "fresh",
      );
      expect(onAction).toHaveBeenCalledOnce();
    });

    // Dialog is gone after submit
    expect(screen.queryByText("Start fresh")).toBeNull();
  });

  it("defaults the reject dialog to iterate mode and sends undefined context when feedback is empty", async () => {
    render(
      <ActionBar runId={RUN_ID} state="AwaitingPlanApproval" onAction={vi.fn()} />,
    );

    await userEvent.click(screen.getByRole("button", { name: /reject plan/i }));
    const rejectButtons = screen.getAllByRole("button", { name: "Reject Plan" });
    await userEvent.click(rejectButtons[rejectButtons.length - 1]);

    await waitFor(() => {
      expect(mockApi.rejectPlan).toHaveBeenCalledWith(RUN_ID, undefined, "iterate");
    });
  });

  it("cancels the reject dialog without calling the API", async () => {
    render(
      <ActionBar runId={RUN_ID} state="AwaitingPlanApproval" onAction={vi.fn()} />,
    );

    await userEvent.click(screen.getByRole("button", { name: /reject plan/i }));
    await userEvent.click(screen.getByRole("button", { name: "Cancel" }));

    expect(screen.queryByText("Start fresh")).toBeNull();
    expect(mockApi.rejectPlan).not.toHaveBeenCalled();
  });

  it("shows Approve & Complete for ReadyForHumanReview and calls api.approveReview", async () => {
    const onAction = vi.fn();
    render(
      <ActionBar runId={RUN_ID} state="ReadyForHumanReview" onAction={onAction} />,
    );

    await userEvent.click(screen.getByRole("button", { name: /approve & complete/i }));
    await userEvent.click(screen.getByRole("button", { name: "Complete Run" }));

    await waitFor(() => {
      expect(mockApi.approveReview).toHaveBeenCalledWith(RUN_ID);
      expect(onAction).toHaveBeenCalledOnce();
    });
  });

  it("shows both Pause and Retry Execution for an active Implementing state", async () => {
    const onAction = vi.fn();
    render(<ActionBar runId={RUN_ID} state="Implementing" onAction={onAction} />);

    expect(screen.getByRole("button", { name: /pause/i })).toBeDefined();
    const retryBtn = screen.getByRole("button", { name: /retry execution/i });
    expect(retryBtn).toBeDefined();

    await userEvent.click(screen.getByRole("button", { name: /pause/i }));
    expect(screen.getByText("Pause Run")).toBeDefined();
    // Two "Pause" buttons now exist: the action-bar trigger and the dialog's
    // own confirm button, which is the one rendered later in the DOM.
    const pauseButtons = screen.getAllByRole("button", { name: "Pause" });
    await userEvent.click(pauseButtons[pauseButtons.length - 1]);

    await waitFor(() => {
      expect(mockApi.pauseRun).toHaveBeenCalledWith(RUN_ID);
      expect(onAction).toHaveBeenCalledOnce();
    });
  });

  it("retries the current stage with the state-specific label and description", async () => {
    const onAction = vi.fn();
    render(<ActionBar runId={RUN_ID} state="Implementing" onAction={onAction} />);

    await userEvent.click(screen.getByRole("button", { name: /retry execution/i }));
    expect(screen.getByRole("heading", { name: "Retry Execution" })).toBeDefined();
    expect(screen.getByText(/Implementing/)).toBeDefined();

    await userEvent.click(screen.getByRole("button", { name: "Retry" }));

    await waitFor(() => {
      expect(mockApi.retryStage).toHaveBeenCalledWith(RUN_ID);
      expect(onAction).toHaveBeenCalledOnce();
    });
  });

  it("shows a Resume action for AIBlocked and calls api.resumeRun", async () => {
    const onAction = vi.fn();
    render(<ActionBar runId={RUN_ID} state="AIBlocked" onAction={onAction} />);

    expect(screen.queryByRole("button", { name: /pause/i })).toBeNull();
    await userEvent.click(screen.getByRole("button", { name: /resume/i }));
    const resumeButtons = screen.getAllByRole("button", { name: "Resume" });
    await userEvent.click(resumeButtons[resumeButtons.length - 1]);

    await waitFor(() => {
      expect(mockApi.resumeRun).toHaveBeenCalledWith(RUN_ID);
      expect(onAction).toHaveBeenCalledOnce();
    });
  });

  it("shows Answer Questions for HumanClarificationNeeded and calls onScrollToQuestions directly (no dialog)", async () => {
    const onScrollToQuestions = vi.fn();
    const onAction = vi.fn();
    render(
      <ActionBar
        runId={RUN_ID}
        state="HumanClarificationNeeded"
        onAction={onAction}
        onScrollToQuestions={onScrollToQuestions}
      />,
    );

    await userEvent.click(screen.getByRole("button", { name: /answer questions/i }));
    expect(onScrollToQuestions).toHaveBeenCalledOnce();
    expect(onAction).not.toHaveBeenCalled();

    // Resume is also available in this state
    expect(screen.getByRole("button", { name: /resume/i })).toBeDefined();
  });

  it("shows loading state (disabled Cancel/Confirm) while the confirm action is pending", async () => {
    let resolveAction!: (v: unknown) => void;
    mockApi.pauseRun.mockReturnValue(
      new Promise((res) => {
        resolveAction = res;
      }),
    );

    render(<ActionBar runId={RUN_ID} state="Implementing" onAction={vi.fn()} />);

    await userEvent.click(screen.getByRole("button", { name: /pause/i }));
    const pauseButtons = screen.getAllByRole("button", { name: "Pause" });
    await userEvent.click(pauseButtons[pauseButtons.length - 1]);

    const workingBtn = screen.getByRole("button", { name: /working/i }) as HTMLButtonElement;
    expect(workingBtn.disabled).toBe(true);
    expect((screen.getByRole("button", { name: "Cancel" }) as HTMLButtonElement).disabled).toBe(
      true,
    );

    resolveAction({ ok: true });
    await waitFor(() => {
      expect(screen.queryByRole("button", { name: /working/i })).toBeNull();
    });
  });

  it("closes the dialog without calling the API when Cancel is clicked", async () => {
    render(<ActionBar runId={RUN_ID} state="Implementing" onAction={vi.fn()} />);

    await userEvent.click(screen.getByRole("button", { name: /pause/i }));
    await userEvent.click(screen.getByRole("button", { name: "Cancel" }));

    expect(screen.queryByText("Pause Run")).toBeNull();
    expect(mockApi.pauseRun).not.toHaveBeenCalled();
  });
});
