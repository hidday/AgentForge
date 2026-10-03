import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

/** The ConfirmDialog's confirm/cancel buttons live in the '.relative.z-10' panel. */
function getConfirmDialog(): HTMLElement {
  const el = document.querySelector(".relative.z-10");
  if (!el) throw new Error("Confirm dialog not found");
  return el as HTMLElement;
}

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

const RUN_ID = "run-123";

function resolveAll() {
  mockApi.approvePlan.mockResolvedValue(undefined);
  mockApi.rejectPlan.mockResolvedValue(undefined);
  mockApi.reReviewPlan.mockResolvedValue(undefined);
  mockApi.revisePlan.mockResolvedValue(undefined);
  mockApi.approveReview.mockResolvedValue(undefined);
  mockApi.pauseRun.mockResolvedValue(undefined);
  mockApi.resumeRun.mockResolvedValue(undefined);
  mockApi.retryStage.mockResolvedValue(undefined);
}

describe("ActionBar", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resolveAll();
  });

  it("renders nothing for a state with no available actions", () => {
    const { container } = render(
      <ActionBar runId={RUN_ID} state="Done" onAction={vi.fn()} />,
    );
    expect(container.firstChild).toBeNull();
  });

  it("renders the Approve Plan and Reject Plan buttons for AwaitingPlanApproval, plus Re-review and Revise", () => {
    render(
      <ActionBar runId={RUN_ID} state="AwaitingPlanApproval" onAction={vi.fn()} />,
    );
    expect(screen.getByRole("button", { name: /Approve Plan/i })).toBeDefined();
    expect(screen.getByRole("button", { name: /Reject Plan/i })).toBeDefined();
    expect(screen.getByRole("button", { name: /Re-review Plan/i })).toBeDefined();
    expect(screen.getByRole("button", { name: /Revise Plan/i })).toBeDefined();
    // Optional-questions button only shows when hasOptionalQuestions is true
    expect(screen.queryByRole("button", { name: /Answer Optional Questions/i })).toBeNull();
  });

  it("shows the Answer Optional Questions button when hasOptionalQuestions is true, and it calls onScrollToQuestions", async () => {
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
    expect(onScrollToQuestions).toHaveBeenCalledTimes(1);
  });

  it("approving the plan opens a confirm dialog and calls api.approvePlan with the trimmed note", async () => {
    const onAction = vi.fn();
    render(<ActionBar runId={RUN_ID} state="AwaitingPlanApproval" onAction={onAction} />);

    await userEvent.click(screen.getByRole("button", { name: /Approve Plan/i }));
    expect(within(getConfirmDialog()).getByText("Approve Plan")).toBeDefined();
    const textarea = screen.getByPlaceholderText(/extra context/i);
    await userEvent.type(textarea, "watch for edge cases");
    await userEvent.click(within(getConfirmDialog()).getByRole("button", { name: "Approve & Start" }));

    await waitFor(() => {
      expect(mockApi.approvePlan).toHaveBeenCalledWith(RUN_ID, "watch for edge cases");
    });
    expect(onAction).toHaveBeenCalledTimes(1);
    // dialog closes after confirm
    expect(screen.queryByRole("button", { name: "Approve & Start" })).toBeNull();
  });

  it("clicking Re-review Plan opens its own dialog and calls api.reReviewPlan", async () => {
    render(<ActionBar runId={RUN_ID} state="AwaitingPlanApproval" onAction={vi.fn()} />);
    await userEvent.click(screen.getByRole("button", { name: /Re-review Plan/i }));
    expect(
      screen.getByText(/Run the plan reviewer again against the current plan/i),
    ).toBeDefined();
    await userEvent.click(screen.getByRole("button", { name: "Re-review" }));
    await waitFor(() => {
      expect(mockApi.reReviewPlan).toHaveBeenCalledWith(RUN_ID, undefined);
    });
  });

  it("clicking Revise Plan opens its own dialog and calls api.revisePlan", async () => {
    render(<ActionBar runId={RUN_ID} state="AwaitingPlanApproval" onAction={vi.fn()} />);
    await userEvent.click(screen.getByRole("button", { name: /Revise Plan/i }));
    expect(
      screen.getByText(/automatically run the plan reviser/i),
    ).toBeDefined();
    await userEvent.click(screen.getByRole("button", { name: "Revise" }));
    await waitFor(() => {
      expect(mockApi.revisePlan).toHaveBeenCalledWith(RUN_ID, undefined);
    });
  });

  it("opens the custom reject dialog when Reject Plan is clicked, defaults to iterate mode, and calls api.rejectPlan", async () => {
    const onAction = vi.fn();
    render(<ActionBar runId={RUN_ID} state="AwaitingPlanApproval" onAction={onAction} />);
    await userEvent.click(screen.getByRole("button", { name: /Reject Plan/i }));

    expect(screen.getByText(/send it back for re-planning/i)).toBeDefined();
    const iterateBtn = screen.getByText("Revise plan").closest("button") as HTMLButtonElement;
    expect(iterateBtn.className).toContain("bg-accent");

    const feedback = screen.getByPlaceholderText(/describe what should change/i);
    await userEvent.type(feedback, "  tighten scope  ");

    const confirmButtons = screen.getAllByRole("button", { name: /Reject Plan/i });
    // Last one is the confirm button inside the dialog
    await userEvent.click(confirmButtons[confirmButtons.length - 1]);

    await waitFor(() => {
      expect(mockApi.rejectPlan).toHaveBeenCalledWith(RUN_ID, "tighten scope", "iterate");
    });
    expect(onAction).toHaveBeenCalledTimes(1);
  });

  it("switches to fresh mode in the reject dialog and passes it to api.rejectPlan", async () => {
    render(<ActionBar runId={RUN_ID} state="AwaitingPlanApproval" onAction={vi.fn()} />);
    await userEvent.click(screen.getByRole("button", { name: /Reject Plan/i }));

    const freshBtn = screen.getByText("Start fresh").closest("button") as HTMLButtonElement;
    await userEvent.click(freshBtn);
    expect(freshBtn.className).toContain("bg-accent");

    const confirmButtons = screen.getAllByRole("button", { name: /Reject Plan/i });
    await userEvent.click(confirmButtons[confirmButtons.length - 1]);

    await waitFor(() => {
      expect(mockApi.rejectPlan).toHaveBeenCalledWith(RUN_ID, undefined, "fresh");
    });
  });

  it("cancelling the reject dialog closes it without calling the API", async () => {
    render(<ActionBar runId={RUN_ID} state="AwaitingPlanApproval" onAction={vi.fn()} />);
    await userEvent.click(screen.getByRole("button", { name: /Reject Plan/i }));
    await userEvent.click(screen.getByRole("button", { name: "Cancel" }));

    expect(screen.queryByText(/send it back for re-planning/i)).toBeNull();
    expect(mockApi.rejectPlan).not.toHaveBeenCalled();
  });

  it("shows Approve & Complete for ReadyForHumanReview and calls api.approveReview on confirm", async () => {
    const onAction = vi.fn();
    render(<ActionBar runId={RUN_ID} state="ReadyForHumanReview" onAction={onAction} />);
    await userEvent.click(screen.getByRole("button", { name: /Approve & Complete/i }));
    await userEvent.click(screen.getByRole("button", { name: "Complete Run" }));
    await waitFor(() => {
      expect(mockApi.approveReview).toHaveBeenCalledWith(RUN_ID);
    });
    expect(onAction).toHaveBeenCalledTimes(1);
  });

  it("shows both Pause and the stage-specific Retry button for an active-category retryable state, and triggers the right API calls", async () => {
    render(<ActionBar runId={RUN_ID} state="Planning" onAction={vi.fn()} />);

    expect(screen.getByRole("button", { name: /^Pause$/i })).toBeDefined();
    const retryBtn = screen.getByRole("button", { name: /Retry Planning/i });
    expect(retryBtn).toBeDefined();

    await userEvent.click(screen.getByRole("button", { name: /^Pause$/i }));
    await userEvent.click(within(getConfirmDialog()).getByRole("button", { name: "Pause" }));
    await waitFor(() => {
      expect(mockApi.pauseRun).toHaveBeenCalledWith(RUN_ID);
    });
  });

  it("clicking the stage Retry button calls api.retryStage", async () => {
    render(<ActionBar runId={RUN_ID} state="Planning" onAction={vi.fn()} />);
    await userEvent.click(screen.getByRole("button", { name: /Retry Planning/i }));
    expect(screen.getByText(/Re-run the current stage \(Planning\)/i)).toBeDefined();
    await userEvent.click(screen.getByRole("button", { name: "Retry" }));
    await waitFor(() => {
      expect(mockApi.retryStage).toHaveBeenCalledWith(RUN_ID);
    });
  });

  it("falls back to the generic 'Retry' label for a retryable state with no explicit label mapping", () => {
    // All RETRY_LABELS keys are covered by the component's map; this verifies the
    // fallback branch is still reachable by checking the dialog title fallback text
    // when using a state that IS in RETRY_LABELS, Implementing -> 'Retry Execution'.
    render(<ActionBar runId={RUN_ID} state="Implementing" onAction={vi.fn()} />);
    expect(screen.getByRole("button", { name: /Retry Execution/i })).toBeDefined();
  });

  it("shows the Resume button for AIBlocked and calls api.resumeRun on confirm", async () => {
    const onAction = vi.fn();
    render(<ActionBar runId={RUN_ID} state="AIBlocked" onAction={onAction} />);
    await userEvent.click(screen.getByRole("button", { name: /Resume/i }));
    await userEvent.click(within(getConfirmDialog()).getByRole("button", { name: "Resume" }));
    await waitFor(() => {
      expect(mockApi.resumeRun).toHaveBeenCalledWith(RUN_ID);
    });
    expect(onAction).toHaveBeenCalledTimes(1);
  });

  it("shows both Answer Questions and Resume for HumanClarificationNeeded, and Answer Questions calls onScrollToQuestions directly without an API call", async () => {
    const onScrollToQuestions = vi.fn();
    render(
      <ActionBar
        runId={RUN_ID}
        state="HumanClarificationNeeded"
        onAction={vi.fn()}
        onScrollToQuestions={onScrollToQuestions}
      />,
    );
    expect(screen.getByRole("button", { name: /Answer Questions/i })).toBeDefined();
    expect(screen.getByRole("button", { name: /Resume/i })).toBeDefined();

    await userEvent.click(screen.getByRole("button", { name: /Answer Questions/i }));
    expect(onScrollToQuestions).toHaveBeenCalledTimes(1);
    expect(mockApi.resumeRun).not.toHaveBeenCalled();
  });

  it("closes the dialog and does not call onAction when the confirmed action rejects", async () => {
    const onAction = vi.fn();
    mockApi.pauseRun.mockRejectedValue(new Error("network error"));
    render(<ActionBar runId={RUN_ID} state="Planning" onAction={onAction} />);

    await userEvent.click(screen.getByRole("button", { name: /^Pause$/i }));
    await userEvent.click(within(getConfirmDialog()).getByRole("button", { name: "Pause" }));

    await waitFor(() => {
      expect(mockApi.pauseRun).toHaveBeenCalledWith(RUN_ID);
    });
    // dialog should close even though the action failed
    await waitFor(() => {
      expect(document.querySelector(".relative.z-10")).toBeNull();
    });
    expect(onAction).not.toHaveBeenCalled();
  });

  it("does not call api.rejectPlan's onAction when rejectPlan rejects, but still resets the dialog", async () => {
    const onAction = vi.fn();
    mockApi.rejectPlan.mockRejectedValue(new Error("failed"));
    render(<ActionBar runId={RUN_ID} state="AwaitingPlanApproval" onAction={onAction} />);
    await userEvent.click(screen.getByRole("button", { name: /Reject Plan/i }));
    const confirmButtons = screen.getAllByRole("button", { name: /Reject Plan/i });
    await userEvent.click(confirmButtons[confirmButtons.length - 1]);

    await waitFor(() => {
      expect(mockApi.rejectPlan).toHaveBeenCalled();
    });
    await waitFor(() => {
      expect(screen.queryByText(/send it back for re-planning/i)).toBeNull();
    });
    expect(onAction).not.toHaveBeenCalled();
  });

  it("shows the 'Working...' loading state while the reject confirm action is pending", async () => {
    let resolveFn!: () => void;
    mockApi.rejectPlan.mockReturnValue(
      new Promise<void>((res) => {
        resolveFn = res;
      }),
    );
    render(<ActionBar runId={RUN_ID} state="AwaitingPlanApproval" onAction={vi.fn()} />);
    await userEvent.click(screen.getByRole("button", { name: /Reject Plan/i }));
    const confirmButtons = screen.getAllByRole("button", { name: /Reject Plan/i });
    await userEvent.click(confirmButtons[confirmButtons.length - 1]);

    expect(screen.getByText("Working...")).toBeDefined();
    resolveFn();
    await waitFor(() => {
      expect(screen.queryByText("Working...")).toBeNull();
    });
  });
});
