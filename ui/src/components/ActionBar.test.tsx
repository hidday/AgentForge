import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { ActionBar } from "./ActionBar";
import { api } from "@/api/client.ts";

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

describe("ActionBar", () => {
  beforeEach(() => {
    vi.mocked(api.approvePlan).mockReset().mockResolvedValue({ ok: true, state: "Implementing" });
    vi.mocked(api.rejectPlan).mockReset().mockResolvedValue({ ok: true, state: "Planning" });
    vi.mocked(api.reReviewPlan).mockReset().mockResolvedValue({ ok: true, runId: "r1" });
    vi.mocked(api.revisePlan).mockReset().mockResolvedValue({ ok: true, runId: "r1" });
    vi.mocked(api.approveReview).mockReset().mockResolvedValue({ ok: true, state: "Done" });
    vi.mocked(api.pauseRun).mockReset().mockResolvedValue({ ok: true });
    vi.mocked(api.resumeRun).mockReset().mockResolvedValue({ ok: true });
    vi.mocked(api.retryStage).mockReset().mockResolvedValue({ ok: true, state: "Planning", retrying: true });
  });

  it("renders nothing for a state with no available actions", () => {
    const { container } = render(
      <ActionBar runId="r1" state="Done" onAction={vi.fn()} />,
    );
    expect(container.firstChild).toBeNull();
  });

  it("shows approve and reject actions when awaiting plan approval", () => {
    render(<ActionBar runId="r1" state="AwaitingPlanApproval" onAction={vi.fn()} />);
    expect(screen.getByText("Approve Plan")).toBeDefined();
    expect(screen.getByText("Reject Plan")).toBeDefined();
    expect(screen.getByText("Re-review Plan")).toBeDefined();
    expect(screen.getByText("Revise Plan")).toBeDefined();
  });

  it("approves a plan via the confirm dialog and reports the note", async () => {
    const onAction = vi.fn();
    render(<ActionBar runId="r1" state="AwaitingPlanApproval" onAction={onAction} />);
    fireEvent.click(screen.getByText("Approve Plan"));

    expect(screen.getByText(/This will approve the current plan/)).toBeDefined();
    const textarea = screen.getByPlaceholderText(/extra context/);
    fireEvent.change(textarea, { target: { value: "watch the auth flow" } });
    fireEvent.click(screen.getByText("Approve & Start"));

    await waitFor(() =>
      expect(api.approvePlan).toHaveBeenCalledWith("r1", "watch the auth flow"),
    );
    await waitFor(() => expect(onAction).toHaveBeenCalled());
  });

  it("closes the dialog on cancel without calling the action", () => {
    render(<ActionBar runId="r1" state="AwaitingPlanApproval" onAction={vi.fn()} />);
    fireEvent.click(screen.getByText("Approve Plan"));
    fireEvent.click(screen.getByText("Cancel"));
    expect(api.approvePlan).not.toHaveBeenCalled();
    expect(screen.queryByText(/This will approve the current plan/)).toBeNull();
  });

  it("opens the reject dialog instead of the generic confirm dialog", () => {
    render(<ActionBar runId="r1" state="AwaitingPlanApproval" onAction={vi.fn()} />);
    fireEvent.click(screen.getByText("Reject Plan"));
    expect(screen.getByText(/send it back for re-planning/)).toBeDefined();
  });

  it("rejects a plan in iterate mode by default with trimmed feedback", async () => {
    const onAction = vi.fn();
    render(<ActionBar runId="r1" state="AwaitingPlanApproval" onAction={onAction} />);
    fireEvent.click(screen.getByText("Reject Plan"));
    const textarea = screen.getByPlaceholderText(/describe what should change/);
    fireEvent.change(textarea, { target: { value: "  needs more detail  " } });

    const rejectButtons = screen.getAllByText("Reject Plan");
    fireEvent.click(rejectButtons[rejectButtons.length - 1]!);

    await waitFor(() =>
      expect(api.rejectPlan).toHaveBeenCalledWith("r1", "needs more detail", "iterate"),
    );
    await waitFor(() => expect(onAction).toHaveBeenCalled());
  });

  it("rejects a plan in fresh mode and with no feedback sends undefined", async () => {
    render(<ActionBar runId="r1" state="AwaitingPlanApproval" onAction={vi.fn()} />);
    fireEvent.click(screen.getByText("Reject Plan"));
    fireEvent.click(screen.getByText("Start fresh"));

    const rejectButtons = screen.getAllByText("Reject Plan");
    fireEvent.click(rejectButtons[rejectButtons.length - 1]!);

    await waitFor(() =>
      expect(api.rejectPlan).toHaveBeenCalledWith("r1", undefined, "fresh"),
    );
  });

  it("cancels the reject dialog and resets its state", () => {
    render(<ActionBar runId="r1" state="AwaitingPlanApproval" onAction={vi.fn()} />);
    fireEvent.click(screen.getByText("Reject Plan"));
    const textarea = screen.getByPlaceholderText(/describe what should change/);
    fireEvent.change(textarea, { target: { value: "some feedback" } });

    const backdrop = document.querySelector(".bg-black\\/60")!;
    fireEvent.click(backdrop);

    expect(screen.queryByPlaceholderText(/describe what should change/)).toBeNull();
    expect(api.rejectPlan).not.toHaveBeenCalled();
  });

  it("re-reviews the plan from its dedicated button", async () => {
    render(<ActionBar runId="r1" state="AwaitingPlanApproval" onAction={vi.fn()} />);
    fireEvent.click(screen.getByText("Re-review Plan"));
    fireEvent.click(screen.getByText("Re-review"));
    await waitFor(() => expect(api.reReviewPlan).toHaveBeenCalledWith("r1", undefined));
  });

  it("revises the plan from its dedicated button", async () => {
    render(<ActionBar runId="r1" state="AwaitingPlanApproval" onAction={vi.fn()} />);
    fireEvent.click(screen.getByText("Revise Plan"));
    fireEvent.click(screen.getByText("Revise"));
    await waitFor(() => expect(api.revisePlan).toHaveBeenCalledWith("r1", undefined));
  });

  it("shows an answer-optional-questions button when there are optional questions", () => {
    const onScroll = vi.fn();
    render(
      <ActionBar
        runId="r1"
        state="AwaitingPlanApproval"
        onAction={vi.fn()}
        onScrollToQuestions={onScroll}
        hasOptionalQuestions
      />,
    );
    fireEvent.click(screen.getByText("Answer Optional Questions"));
    expect(onScroll).toHaveBeenCalled();
  });

  it("shows an approve & complete action when ready for human review", async () => {
    const onAction = vi.fn();
    render(<ActionBar runId="r1" state="ReadyForHumanReview" onAction={onAction} />);
    fireEvent.click(screen.getByText("Approve & Complete"));
    fireEvent.click(screen.getByText("Complete Run"));
    await waitFor(() => expect(api.approveReview).toHaveBeenCalledWith("r1"));
  });

  it("shows a pause action for an active state", async () => {
    render(<ActionBar runId="r1" state="Implementing" onAction={vi.fn()} />);
    fireEvent.click(screen.getAllByText("Pause")[0]!);
    fireEvent.click(screen.getAllByText("Pause")[1]!);
    await waitFor(() => expect(api.pauseRun).toHaveBeenCalledWith("r1"));
  });

  it("shows a resume action for a blocked state", async () => {
    render(<ActionBar runId="r1" state="AIBlocked" onAction={vi.fn()} />);
    fireEvent.click(screen.getByText("Resume"));
    fireEvent.click(screen.getAllByText("Resume")[1]!);
    await waitFor(() => expect(api.resumeRun).toHaveBeenCalledWith("r1"));
  });

  it("shows a resume action for HumanClarificationNeeded", () => {
    render(<ActionBar runId="r1" state="HumanClarificationNeeded" onAction={vi.fn()} />);
    expect(screen.getAllByText("Resume").length).toBeGreaterThan(0);
    expect(screen.getByText("Answer Questions")).toBeDefined();
  });

  it("shows a resume action for a Failed state", () => {
    render(<ActionBar runId="r1" state="Failed" onAction={vi.fn()} />);
    expect(screen.getByText("Resume")).toBeDefined();
  });

  it("shows an answer-questions button that scrolls without opening a dialog", () => {
    const onScroll = vi.fn();
    render(
      <ActionBar
        runId="r1"
        state="HumanClarificationNeeded"
        onAction={vi.fn()}
        onScrollToQuestions={onScroll}
      />,
    );
    fireEvent.click(screen.getByText("Answer Questions"));
    expect(onScroll).toHaveBeenCalled();
  });

  it("shows a start-run retry action for Todo", async () => {
    render(<ActionBar runId="r1" state="Todo" onAction={vi.fn()} />);
    fireEvent.click(screen.getByText("Start Run"));
    fireEvent.click(screen.getByText("Retry"));
    await waitFor(() => expect(api.retryStage).toHaveBeenCalledWith("r1"));
  });

  it("shows a retry-planning action with the specific label for the Planning state", () => {
    render(<ActionBar runId="r1" state="Planning" onAction={vi.fn()} />);
    expect(screen.getByText("Retry Planning")).toBeDefined();
  });

  it("shows a generic retry label for a retryable state without a specific mapping", () => {
    render(<ActionBar runId="r1" state="PlanRevision" onAction={vi.fn()} />);
    expect(screen.getByText("Retry Plan Revision")).toBeDefined();
  });

  it("swallows action errors without calling onAction", async () => {
    vi.mocked(api.pauseRun).mockRejectedValue(new Error("network down"));
    const onAction = vi.fn();
    render(<ActionBar runId="r1" state="Implementing" onAction={onAction} />);
    fireEvent.click(screen.getAllByText("Pause")[0]!);
    fireEvent.click(screen.getAllByText("Pause")[1]!);
    await waitFor(() => expect(api.pauseRun).toHaveBeenCalled());
    expect(onAction).not.toHaveBeenCalled();
  });

  it("swallows reject errors and still resets dialog state", async () => {
    vi.mocked(api.rejectPlan).mockRejectedValue(new Error("boom"));
    render(<ActionBar runId="r1" state="AwaitingPlanApproval" onAction={vi.fn()} />);
    fireEvent.click(screen.getByText("Reject Plan"));
    const rejectButtons = screen.getAllByText("Reject Plan");
    fireEvent.click(rejectButtons[rejectButtons.length - 1]!);
    await waitFor(() => expect(api.rejectPlan).toHaveBeenCalled());
    await waitFor(() =>
      expect(screen.queryByPlaceholderText(/describe what should change/)).toBeNull(),
    );
  });
});
