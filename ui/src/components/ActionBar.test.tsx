import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
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

const mockApi = api as unknown as Record<string, ReturnType<typeof vi.fn>>;

const RUN_ID = "run-1";

describe("ActionBar", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    for (const key of Object.keys(mockApi)) {
      mockApi[key].mockResolvedValue({ ok: true });
    }
  });

  it("renders nothing for a state with no available actions", () => {
    const { container } = render(
      <ActionBar runId={RUN_ID} state="Done" onAction={vi.fn()} />,
    );
    expect(container.firstChild).toBeNull();
  });

  it("shows Approve Plan and Reject Plan for AwaitingPlanApproval, plus re-review and revise buttons", () => {
    render(<ActionBar runId={RUN_ID} state="AwaitingPlanApproval" onAction={vi.fn()} />);
    expect(screen.getByRole("button", { name: /Approve Plan/i })).toBeDefined();
    expect(screen.getByRole("button", { name: /Reject Plan/i })).toBeDefined();
    expect(screen.getByRole("button", { name: /Re-review Plan/i })).toBeDefined();
    expect(screen.getByRole("button", { name: /Revise Plan/i })).toBeDefined();
  });

  it("opens the confirm dialog and calls api.approvePlan with a note on confirm", async () => {
    const onAction = vi.fn();
    render(<ActionBar runId={RUN_ID} state="AwaitingPlanApproval" onAction={onAction} />);

    await userEvent.click(screen.getByRole("button", { name: /^Approve Plan$/i }));
    expect(screen.getByText("Approve & Start")).toBeDefined();

    const textarea = screen.getByPlaceholderText(/extra context/i);
    await userEvent.type(textarea, "watch for edge cases");
    await userEvent.click(screen.getByRole("button", { name: "Approve & Start" }));

    expect(mockApi.approvePlan).toHaveBeenCalledWith(RUN_ID, "watch for edge cases");
    expect(onAction).toHaveBeenCalledTimes(1);
  });

  it("cancels the confirm dialog without calling the action", async () => {
    render(<ActionBar runId={RUN_ID} state="AwaitingPlanApproval" onAction={vi.fn()} />);
    await userEvent.click(screen.getByRole("button", { name: /^Approve Plan$/i }));
    await userEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(mockApi.approvePlan).not.toHaveBeenCalled();
    expect(screen.queryByText("Approve & Start")).toBeNull();
  });

  it("opens the custom reject dialog (not the generic ConfirmDialog) for Reject Plan", async () => {
    render(<ActionBar runId={RUN_ID} state="AwaitingPlanApproval" onAction={vi.fn()} />);
    await userEvent.click(screen.getByRole("button", { name: /^Reject Plan$/i }));
    expect(screen.getByText("Revise plan")).toBeDefined();
    expect(screen.getByText("Start fresh")).toBeDefined();
  });

  it("rejects the plan in 'iterate' mode by default with trimmed feedback", async () => {
    const onAction = vi.fn();
    render(<ActionBar runId={RUN_ID} state="AwaitingPlanApproval" onAction={onAction} />);
    await userEvent.click(screen.getByRole("button", { name: /^Reject Plan$/i }));

    const textarea = screen.getByPlaceholderText(/describe what should change/i);
    await userEvent.type(textarea, "  needs more detail  ");

    const confirmButtons = screen.getAllByRole("button", { name: "Reject Plan" });
    await userEvent.click(confirmButtons[confirmButtons.length - 1]);

    expect(mockApi.rejectPlan).toHaveBeenCalledWith(RUN_ID, "needs more detail", "iterate");
    expect(onAction).toHaveBeenCalledTimes(1);
  });

  it("rejects the plan in 'fresh' mode when that toggle is selected, with undefined feedback when blank", async () => {
    render(<ActionBar runId={RUN_ID} state="AwaitingPlanApproval" onAction={vi.fn()} />);
    await userEvent.click(screen.getByRole("button", { name: /^Reject Plan$/i }));
    await userEvent.click(screen.getByText("Start fresh"));

    const confirmButtons = screen.getAllByRole("button", { name: "Reject Plan" });
    await userEvent.click(confirmButtons[confirmButtons.length - 1]);

    expect(mockApi.rejectPlan).toHaveBeenCalledWith(RUN_ID, undefined, "fresh");
  });

  it("cancels the reject dialog without calling rejectPlan", async () => {
    render(<ActionBar runId={RUN_ID} state="AwaitingPlanApproval" onAction={vi.fn()} />);
    await userEvent.click(screen.getByRole("button", { name: /^Reject Plan$/i }));
    await userEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(mockApi.rejectPlan).not.toHaveBeenCalled();
    expect(screen.queryByText("Revise plan")).toBeNull();
  });

  it("calls api.reReviewPlan with the note from the re-review dialog", async () => {
    render(<ActionBar runId={RUN_ID} state="AwaitingPlanApproval" onAction={vi.fn()} />);
    await userEvent.click(screen.getByRole("button", { name: /^Re-review Plan$/i }));
    expect(screen.getByText("Re-review Plan", { selector: "h3" })).toBeDefined();

    await userEvent.click(screen.getByRole("button", { name: "Re-review" }));
    expect(mockApi.reReviewPlan).toHaveBeenCalledWith(RUN_ID, undefined);
  });

  it("calls api.revisePlan with the note from the revise dialog", async () => {
    render(<ActionBar runId={RUN_ID} state="AwaitingPlanApproval" onAction={vi.fn()} />);
    await userEvent.click(screen.getByRole("button", { name: /^Revise Plan$/i }));

    const textarea = screen.getByPlaceholderText(/tighten the rollout step/i);
    await userEvent.type(textarea, "tighten step 3");
    await userEvent.click(screen.getByRole("button", { name: "Revise" }));

    expect(mockApi.revisePlan).toHaveBeenCalledWith(RUN_ID, "tighten step 3");
  });

  it("shows Approve & Complete for ReadyForHumanReview and calls api.approveReview", async () => {
    render(<ActionBar runId={RUN_ID} state="ReadyForHumanReview" onAction={vi.fn()} />);
    await userEvent.click(screen.getByRole("button", { name: /Approve & Complete/i }));
    await userEvent.click(screen.getByRole("button", { name: "Complete Run" }));
    expect(mockApi.approveReview).toHaveBeenCalledWith(RUN_ID);
  });

  it("shows Pause for an active-category state and calls api.pauseRun", async () => {
    render(<ActionBar runId={RUN_ID} state="Implementing" onAction={vi.fn()} />);
    await userEvent.click(screen.getByRole("button", { name: /^Pause$/i }));
    const confirmButtons = screen.getAllByRole("button", { name: "Pause" });
    await userEvent.click(confirmButtons[confirmButtons.length - 1]);
    expect(mockApi.pauseRun).toHaveBeenCalledWith(RUN_ID);
  });

  it.each(["AIBlocked", "HumanClarificationNeeded", "Failed"])(
    "shows Resume for %s and calls api.resumeRun",
    async (state) => {
      render(<ActionBar runId={RUN_ID} state={state} onAction={vi.fn()} />);
      await userEvent.click(screen.getByRole("button", { name: /^Resume$/i }));
      const confirmButtons = screen.getAllByRole("button", { name: "Resume" });
      await userEvent.click(confirmButtons[confirmButtons.length - 1]);
      expect(mockApi.resumeRun).toHaveBeenCalledWith(RUN_ID);
    },
  );

  it.each([
    ["Todo", "Start Run"],
    ["Planning", "Retry Planning"],
    ["PlanRevision", "Retry Plan Revision"],
    ["Implementing", "Retry Execution"],
    ["AIReview", "Retry Code Review"],
    ["AddressingReview", "Retry Remediation"],
  ])("shows the retry-labeled button %s -> %s and calls api.retryStage", async (state, label) => {
    render(<ActionBar runId={RUN_ID} state={state} onAction={vi.fn()} />);
    await userEvent.click(screen.getByRole("button", { name: label }));
    await userEvent.click(screen.getByRole("button", { name: "Retry" }));
    expect(mockApi.retryStage).toHaveBeenCalledWith(RUN_ID);
  });

  it("shows the Answer Questions button for HumanClarificationNeeded and calls onScrollToQuestions", async () => {
    const onScrollToQuestions = vi.fn();
    render(
      <ActionBar
        runId={RUN_ID}
        state="HumanClarificationNeeded"
        onAction={vi.fn()}
        onScrollToQuestions={onScrollToQuestions}
      />,
    );
    await userEvent.click(screen.getByRole("button", { name: /Answer Questions/i }));
    expect(onScrollToQuestions).toHaveBeenCalledTimes(1);
  });

  it("shows the Answer Optional Questions button only when hasOptionalQuestions is true on AwaitingPlanApproval", () => {
    const { rerender } = render(
      <ActionBar
        runId={RUN_ID}
        state="AwaitingPlanApproval"
        onAction={vi.fn()}
        hasOptionalQuestions={false}
      />,
    );
    expect(screen.queryByText(/Answer Optional Questions/i)).toBeNull();

    rerender(
      <ActionBar
        runId={RUN_ID}
        state="AwaitingPlanApproval"
        onAction={vi.fn()}
        hasOptionalQuestions
      />,
    );
    expect(screen.getByText(/Answer Optional Questions/i)).toBeDefined();
  });

  it("disables confirm/cancel and shows a working indicator while the action promise is pending", async () => {
    let resolveAction!: () => void;
    mockApi.pauseRun.mockReturnValue(
      new Promise<void>((resolve) => {
        resolveAction = resolve;
      }),
    );
    render(<ActionBar runId={RUN_ID} state="Implementing" onAction={vi.fn()} />);
    await userEvent.click(screen.getByRole("button", { name: /^Pause$/i }));
    const confirmButtons = screen.getAllByRole("button", { name: "Pause" });
    await userEvent.click(confirmButtons[confirmButtons.length - 1]);

    expect(screen.getByText(/Working/i)).toBeDefined();
    resolveAction();
  });

  it("closes the dialog and does not call onAction when the action rejects", async () => {
    mockApi.pauseRun.mockRejectedValue(new Error("network down"));
    const onAction = vi.fn();
    render(<ActionBar runId={RUN_ID} state="Implementing" onAction={onAction} />);
    await userEvent.click(screen.getByRole("button", { name: /^Pause$/i }));
    const confirmButtons = screen.getAllByRole("button", { name: "Pause" });
    await userEvent.click(confirmButtons[confirmButtons.length - 1]);

    expect(onAction).not.toHaveBeenCalled();
    expect(screen.queryByText("Pause Run", { selector: "h3" })).toBeNull();
  });
});
