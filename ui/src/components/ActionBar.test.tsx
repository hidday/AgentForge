import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
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

const mockApi = api as unknown as Record<string, ReturnType<typeof vi.fn>>;

describe("ActionBar", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    for (const key of Object.keys(mockApi)) {
      mockApi[key].mockResolvedValue({ ok: true });
    }
  });

  it("renders nothing when the state has no applicable actions", () => {
    const { container } = render(
      <ActionBar runId="run-1" state="Done" onAction={vi.fn()} />,
    );
    expect(container.firstChild).toBeNull();
  });

  it("shows Answer Questions for HumanClarificationNeeded and calls onScrollToQuestions", async () => {
    const onScroll = vi.fn();
    render(
      <ActionBar
        runId="run-1"
        state="HumanClarificationNeeded"
        onAction={vi.fn()}
        onScrollToQuestions={onScroll}
      />,
    );
    await userEvent.click(screen.getByText("Answer Questions"));
    expect(onScroll).toHaveBeenCalledOnce();
  });

  it("shows Answer Optional Questions only when hasOptionalQuestions is true for AwaitingPlanApproval", () => {
    render(
      <ActionBar
        runId="run-1"
        state="AwaitingPlanApproval"
        onAction={vi.fn()}
        hasOptionalQuestions={true}
      />,
    );
    expect(screen.getByText("Answer Optional Questions")).toBeDefined();
  });

  it("does not show Answer Optional Questions when hasOptionalQuestions is false", () => {
    render(
      <ActionBar runId="run-1" state="AwaitingPlanApproval" onAction={vi.fn()} />,
    );
    expect(screen.queryByText("Answer Optional Questions")).toBeNull();
  });

  it("opens the Approve Plan confirm dialog and calls api.approvePlan with the entered note", async () => {
    const onAction = vi.fn();
    render(<ActionBar runId="run-1" state="AwaitingPlanApproval" onAction={onAction} />);

    await userEvent.click(screen.getByText("Approve Plan"));
    expect(screen.getByText("Approve & Start")).toBeDefined();

    const textarea = screen.getByPlaceholderText(/extra context/i);
    await userEvent.type(textarea, "watch the edge case");
    await userEvent.click(screen.getByRole("button", { name: "Approve & Start" }));

    expect(mockApi.approvePlan).toHaveBeenCalledWith("run-1", "watch the edge case");
    expect(onAction).toHaveBeenCalledOnce();
  });

  it("opens the custom Reject Plan dialog, defaults to iterate mode, and submits feedback", async () => {
    const onAction = vi.fn();
    render(<ActionBar runId="run-1" state="AwaitingPlanApproval" onAction={onAction} />);

    await userEvent.click(screen.getByText("Reject Plan"));
    expect(screen.getByText("This will reject the current plan and send it back for re-planning.")).toBeDefined();

    const textarea = screen.getByPlaceholderText(/describe what should change/i);
    await userEvent.type(textarea, "please redo step 2");

    const rejectButtons = screen.getAllByRole("button", { name: "Reject Plan" });
    await userEvent.click(rejectButtons[rejectButtons.length - 1]!);

    expect(mockApi.rejectPlan).toHaveBeenCalledWith("run-1", "please redo step 2", "iterate");
    expect(onAction).toHaveBeenCalledOnce();
  });

  it("switches to fresh mode in the reject dialog and submits with mode='fresh'", async () => {
    render(<ActionBar runId="run-1" state="AwaitingPlanApproval" onAction={vi.fn()} />);

    await userEvent.click(screen.getByText("Reject Plan"));
    await userEvent.click(screen.getByText("Start fresh"));
    const rejectButtons = screen.getAllByRole("button", { name: "Reject Plan" });
    await userEvent.click(rejectButtons[rejectButtons.length - 1]!);

    expect(mockApi.rejectPlan).toHaveBeenCalledWith("run-1", undefined, "fresh");
  });

  it("closes the reject dialog on cancel without calling the API", async () => {
    render(<ActionBar runId="run-1" state="AwaitingPlanApproval" onAction={vi.fn()} />);

    await userEvent.click(screen.getByText("Reject Plan"));
    await userEvent.click(screen.getByRole("button", { name: "Cancel" }));

    expect(mockApi.rejectPlan).not.toHaveBeenCalled();
    expect(
      screen.queryByText("This will reject the current plan and send it back for re-planning."),
    ).toBeNull();
  });

  it("shows Re-review Plan and Revise Plan buttons for AwaitingPlanApproval and calls their actions", async () => {
    render(<ActionBar runId="run-1" state="AwaitingPlanApproval" onAction={vi.fn()} />);

    await userEvent.click(screen.getByText("Re-review Plan"));
    await userEvent.click(screen.getByRole("button", { name: "Re-review" }));
    expect(mockApi.reReviewPlan).toHaveBeenCalledWith("run-1", undefined);
  });

  it("calls revisePlan via the Revise Plan dialog", async () => {
    render(<ActionBar runId="run-1" state="AwaitingPlanApproval" onAction={vi.fn()} />);

    await userEvent.click(screen.getByText("Revise Plan"));
    await userEvent.click(screen.getByRole("button", { name: "Revise" }));
    expect(mockApi.revisePlan).toHaveBeenCalledWith("run-1", undefined);
  });

  it("shows Approve & Complete for ReadyForHumanReview and calls approveReview", async () => {
    render(<ActionBar runId="run-1" state="ReadyForHumanReview" onAction={vi.fn()} />);
    await userEvent.click(screen.getByText("Approve & Complete"));
    await userEvent.click(screen.getByRole("button", { name: "Complete Run" }));
    expect(mockApi.approveReview).toHaveBeenCalledWith("run-1");
  });

  it("shows a retry action with a stage-specific label for Implementing and calls retryStage", async () => {
    render(<ActionBar runId="run-1" state="Implementing" onAction={vi.fn()} />);
    await userEvent.click(screen.getByText("Retry Execution"));
    await userEvent.click(screen.getByRole("button", { name: "Retry" }));
    expect(mockApi.retryStage).toHaveBeenCalledWith("run-1");
  });

  it("also shows Pause alongside Retry for an active-category state and calls pauseRun", async () => {
    render(<ActionBar runId="run-1" state="Implementing" onAction={vi.fn()} />);
    await userEvent.click(screen.getByText("Pause"));
    const pauseButtons = screen.getAllByRole("button", { name: "Pause" });
    await userEvent.click(pauseButtons[pauseButtons.length - 1]!);
    expect(mockApi.pauseRun).toHaveBeenCalledWith("run-1");
  });

  it("shows Resume for AIBlocked/HumanClarificationNeeded/Failed and calls resumeRun", async () => {
    render(<ActionBar runId="run-1" state="Failed" onAction={vi.fn()} />);
    await userEvent.click(screen.getByText("Resume"));
    const resumeButtons = screen.getAllByRole("button", { name: "Resume" });
    await userEvent.click(resumeButtons[resumeButtons.length - 1]!);
    expect(mockApi.resumeRun).toHaveBeenCalledWith("run-1");
  });

  it("shows a state-specific retry label for a state in RETRY_LABELS", () => {
    render(<ActionBar runId="run-1" state="Todo" onAction={vi.fn()} />);
    expect(screen.getByText("Start Run")).toBeDefined();
  });

  it("keeps the confirm dialog open with loading indicator while the action is pending, then closes on success", async () => {
    let resolveAction!: (v: unknown) => void;
    mockApi.approveReview.mockReturnValue(
      new Promise((res) => {
        resolveAction = res;
      }),
    );
    const onAction = vi.fn();
    render(<ActionBar runId="run-1" state="ReadyForHumanReview" onAction={onAction} />);

    await userEvent.click(screen.getByText("Approve & Complete"));
    await userEvent.click(screen.getByRole("button", { name: "Complete Run" }));

    expect(screen.getByText("Working...")).toBeDefined();

    resolveAction({ ok: true });
    await screen.findByText("Approve & Complete");
    expect(onAction).toHaveBeenCalledOnce();
  });

  it("closes the dialog without calling onAction when the dialog action rejects", async () => {
    mockApi.pauseRun.mockRejectedValue(new Error("fail"));
    const onAction = vi.fn();
    render(<ActionBar runId="run-1" state="Implementing" onAction={onAction} />);

    await userEvent.click(screen.getByText("Pause"));
    const pauseButtons = screen.getAllByRole("button", { name: "Pause" });
    await userEvent.click(pauseButtons[pauseButtons.length - 1]!);

    await screen.findByText("Pause");
    expect(onAction).not.toHaveBeenCalled();
  });
});
