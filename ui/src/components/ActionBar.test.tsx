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

import { api } from "@/api/client.ts";
import { ActionBar } from "./ActionBar.tsx";

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
  });

  it("renders nothing for a state with no applicable actions", () => {
    const { container } = render(
      <ActionBar runId="run-1" state="Done" onAction={vi.fn()} />,
    );
    expect(container.firstChild).toBeNull();
  });

  it("shows Approve Plan, Reject Plan, Re-review Plan and Revise Plan for AwaitingPlanApproval", () => {
    render(<ActionBar runId="run-1" state="AwaitingPlanApproval" onAction={vi.fn()} />);
    expect(screen.getByRole("button", { name: /Approve Plan/i })).toBeDefined();
    expect(screen.getByRole("button", { name: /Reject Plan/i })).toBeDefined();
    expect(screen.getByRole("button", { name: /Re-review Plan/i })).toBeDefined();
    expect(screen.getByRole("button", { name: /Revise Plan/i })).toBeDefined();
  });

  it("approving the plan opens the confirm dialog and calls api.approvePlan with a note", async () => {
    mockApi.approvePlan.mockResolvedValue({ ok: true, state: "Implementing" });
    const onAction = vi.fn();
    render(<ActionBar runId="run-1" state="AwaitingPlanApproval" onAction={onAction} />);

    await userEvent.click(screen.getByRole("button", { name: /Approve Plan/i }));
    expect(screen.getByText("Approve & Start")).toBeDefined();

    const textarea = screen.getByPlaceholderText(/extra context/i);
    await userEvent.type(textarea, "watch for edge case X");
    await userEvent.click(screen.getByRole("button", { name: "Approve & Start" }));

    await waitFor(() => expect(mockApi.approvePlan).toHaveBeenCalledWith("run-1", "watch for edge case X"));
    await waitFor(() => expect(onAction).toHaveBeenCalled());
  });

  it("dismisses the confirm dialog via Cancel without calling the API", async () => {
    render(<ActionBar runId="run-1" state="AwaitingPlanApproval" onAction={vi.fn()} />);
    await userEvent.click(screen.getByRole("button", { name: /Approve Plan/i }));
    await userEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(mockApi.approvePlan).not.toHaveBeenCalled();
    expect(screen.queryByText("Approve & Start")).toBeNull();
  });

  it("still closes the dialog when the confirmed action rejects", async () => {
    mockApi.approvePlan.mockRejectedValue(new Error("server error"));
    render(<ActionBar runId="run-1" state="AwaitingPlanApproval" onAction={vi.fn()} />);
    await userEvent.click(screen.getByRole("button", { name: /Approve Plan/i }));
    await userEvent.click(screen.getByRole("button", { name: "Approve & Start" }));

    await waitFor(() => expect(screen.queryByText("Approve & Start")).toBeNull());
  });

  it("opens the reject dialog, toggles reject mode, and submits feedback", async () => {
    mockApi.rejectPlan.mockResolvedValue({ ok: true, state: "Planning" });
    const onAction = vi.fn();
    render(<ActionBar runId="run-1" state="AwaitingPlanApproval" onAction={onAction} />);

    await userEvent.click(screen.getByRole("button", { name: /Reject Plan/i }));
    expect(screen.getByText("This will reject the current plan and send it back for re-planning.")).toBeDefined();

    await userEvent.click(screen.getByText("Start fresh"));
    // Toggle back to "Revise plan" (iterate) to exercise both mode-select click handlers.
    await userEvent.click(screen.getByText("Revise plan"));
    await userEvent.click(screen.getByText("Start fresh"));
    const textarea = screen.getByPlaceholderText(/describe what should change/i);
    await userEvent.type(textarea, "  redo step 2  ");

    const confirmButtons = screen.getAllByRole("button", { name: "Reject Plan" });
    // Second "Reject Plan" button is the dialog's submit button.
    await userEvent.click(confirmButtons[confirmButtons.length - 1]!);

    await waitFor(() =>
      expect(mockApi.rejectPlan).toHaveBeenCalledWith("run-1", "redo step 2", "fresh"),
    );
    expect(onAction).toHaveBeenCalled();
  });

  it("submits the reject dialog with undefined context when the feedback field is left blank", async () => {
    mockApi.rejectPlan.mockResolvedValue({ ok: true, state: "Planning" });
    render(<ActionBar runId="run-1" state="AwaitingPlanApproval" onAction={vi.fn()} />);

    await userEvent.click(screen.getByRole("button", { name: /Reject Plan/i }));
    const confirmButtons = screen.getAllByRole("button", { name: "Reject Plan" });
    await userEvent.click(confirmButtons[confirmButtons.length - 1]!);

    await waitFor(() =>
      expect(mockApi.rejectPlan).toHaveBeenCalledWith("run-1", undefined, "iterate"),
    );
  });

  it("closes the reject dialog via Cancel without calling the API", async () => {
    render(<ActionBar runId="run-1" state="AwaitingPlanApproval" onAction={vi.fn()} />);
    await userEvent.click(screen.getByRole("button", { name: /Reject Plan/i }));
    await userEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(mockApi.rejectPlan).not.toHaveBeenCalled();
    expect(
      screen.queryByText("This will reject the current plan and send it back for re-planning."),
    ).toBeNull();
  });

  it("triggers re-review with notes via the confirm dialog", async () => {
    mockApi.reReviewPlan.mockResolvedValue({ ok: true, runId: "run-1" });
    render(<ActionBar runId="run-1" state="AwaitingPlanApproval" onAction={vi.fn()} />);
    await userEvent.click(screen.getByRole("button", { name: /Re-review Plan/i }));
    await userEvent.click(screen.getByRole("button", { name: "Re-review" }));
    await waitFor(() => expect(mockApi.reReviewPlan).toHaveBeenCalledWith("run-1", undefined));
  });

  it("triggers revise plan via the confirm dialog", async () => {
    mockApi.revisePlan.mockResolvedValue({ ok: true, runId: "run-1" });
    render(<ActionBar runId="run-1" state="AwaitingPlanApproval" onAction={vi.fn()} />);
    await userEvent.click(screen.getByRole("button", { name: /^Revise Plan$/i }));
    await userEvent.click(screen.getByRole("button", { name: "Revise" }));
    await waitFor(() => expect(mockApi.revisePlan).toHaveBeenCalledWith("run-1", undefined));
  });

  it("shows Approve & Complete for ReadyForHumanReview and calls approveReview", async () => {
    mockApi.approveReview.mockResolvedValue({ ok: true, state: "Done" });
    const onAction = vi.fn();
    render(<ActionBar runId="run-1" state="ReadyForHumanReview" onAction={onAction} />);
    await userEvent.click(screen.getByRole("button", { name: /Approve & Complete/i }));
    await userEvent.click(screen.getByRole("button", { name: "Complete Run" }));
    await waitFor(() => expect(mockApi.approveReview).toHaveBeenCalledWith("run-1"));
    expect(onAction).toHaveBeenCalled();
  });

  it("shows Pause for an active-category state and calls pauseRun", async () => {
    mockApi.pauseRun.mockResolvedValue({ ok: true });
    render(<ActionBar runId="run-1" state="Implementing" onAction={vi.fn()} />);
    await userEvent.click(screen.getByRole("button", { name: /^Pause$/i }));
    const pauseButtons = screen.getAllByRole("button", { name: "Pause" });
    await userEvent.click(pauseButtons[pauseButtons.length - 1]!);
    await waitFor(() => expect(mockApi.pauseRun).toHaveBeenCalledWith("run-1"));
  });

  it("shows Resume for AIBlocked and calls resumeRun", async () => {
    mockApi.resumeRun.mockResolvedValue({ ok: true });
    render(<ActionBar runId="run-1" state="AIBlocked" onAction={vi.fn()} />);
    await userEvent.click(screen.getByRole("button", { name: /Resume/i }));
    const resumeButtons = screen.getAllByRole("button", { name: "Resume" });
    await userEvent.click(resumeButtons[resumeButtons.length - 1]!);
    await waitFor(() => expect(mockApi.resumeRun).toHaveBeenCalledWith("run-1"));
  });

  it("shows a Retry action with a state-specific label and calls retryStage", async () => {
    mockApi.retryStage.mockResolvedValue({ ok: true, state: "Implementing", retrying: true });
    render(<ActionBar runId="run-1" state="Implementing" onAction={vi.fn()} />);
    const retryBtn = screen.getByRole("button", { name: "Retry Execution" });
    await userEvent.click(retryBtn);
    await userEvent.click(screen.getByRole("button", { name: "Retry" }));
    await waitFor(() => expect(mockApi.retryStage).toHaveBeenCalledWith("run-1"));
  });

  it("shows 'Start Run' as the retry label for Todo state", () => {
    render(<ActionBar runId="run-1" state="Todo" onAction={vi.fn()} />);
    expect(screen.getByRole("button", { name: "Start Run" })).toBeDefined();
  });

  it("calls onScrollToQuestions when Answer Questions is clicked for HumanClarificationNeeded", async () => {
    const onScrollToQuestions = vi.fn();
    render(
      <ActionBar
        runId="run-1"
        state="HumanClarificationNeeded"
        onAction={vi.fn()}
        onScrollToQuestions={onScrollToQuestions}
      />,
    );
    await userEvent.click(screen.getByRole("button", { name: /Answer Questions/i }));
    expect(onScrollToQuestions).toHaveBeenCalled();
  });

  it("shows Answer Optional Questions only when hasOptionalQuestions is true for AwaitingPlanApproval", async () => {
    const onScrollToQuestions = vi.fn();
    render(
      <ActionBar
        runId="run-1"
        state="AwaitingPlanApproval"
        onAction={vi.fn()}
        onScrollToQuestions={onScrollToQuestions}
        hasOptionalQuestions
      />,
    );
    await userEvent.click(screen.getByRole("button", { name: /Answer Optional Questions/i }));
    expect(onScrollToQuestions).toHaveBeenCalled();
  });

  it("does not show Answer Optional Questions when hasOptionalQuestions is false", () => {
    render(<ActionBar runId="run-1" state="AwaitingPlanApproval" onAction={vi.fn()} />);
    expect(screen.queryByRole("button", { name: /Answer Optional Questions/i })).toBeNull();
  });
});
