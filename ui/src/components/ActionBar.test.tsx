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

const mockApi = api as unknown as Record<string, ReturnType<typeof vi.fn>>;

const RUN_ID = "run-1";

describe("ActionBar", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    for (const key of Object.keys(mockApi)) {
      mockApi[key].mockResolvedValue(undefined);
    }
  });

  it("renders nothing for a state with no applicable actions", () => {
    const { container } = render(
      <ActionBar runId={RUN_ID} state="Done" onAction={vi.fn()} />,
    );
    expect(container).toBeEmptyDOMElement();
  });

  it("shows Approve Plan and Reject Plan for AwaitingPlanApproval, and calls approvePlan + onAction on confirm", async () => {
    const user = userEvent.setup();
    const onAction = vi.fn();
    render(<ActionBar runId={RUN_ID} state="AwaitingPlanApproval" onAction={onAction} />);

    expect(screen.getByRole("button", { name: /Approve Plan/ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Reject Plan/ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Re-review Plan/ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Revise Plan/ })).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /Approve Plan/ }));
    expect(screen.getByText("Approve & Start")).toBeInTheDocument();

    const noteField = screen.getByPlaceholderText(/extra context/);
    await user.type(noteField, "watch out for X");

    await user.click(screen.getByRole("button", { name: "Approve & Start" }));

    await waitFor(() => expect(mockApi.approvePlan).toHaveBeenCalledWith(RUN_ID, "watch out for X"));
    await waitFor(() => expect(onAction).toHaveBeenCalledTimes(1));
  });

  it("shows Answer Optional Questions when hasOptionalQuestions is true and calls onScrollToQuestions", async () => {
    const user = userEvent.setup();
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
    const btn = screen.getByRole("button", { name: /Answer Optional Questions/ });
    await user.click(btn);
    expect(onScrollToQuestions).toHaveBeenCalledTimes(1);
  });

  it("does not show Answer Optional Questions when hasOptionalQuestions is false", () => {
    render(
      <ActionBar runId={RUN_ID} state="AwaitingPlanApproval" onAction={vi.fn()} />,
    );
    expect(screen.queryByText(/Answer Optional Questions/)).not.toBeInTheDocument();
  });

  it("opens the reject dialog, supports switching modes, and calls rejectPlan with trimmed context and selected mode", async () => {
    const user = userEvent.setup();
    const onAction = vi.fn();
    render(<ActionBar runId={RUN_ID} state="AwaitingPlanApproval" onAction={onAction} />);

    await user.click(screen.getByRole("button", { name: /Reject Plan/ }));
    expect(screen.getByText("This will reject the current plan and send it back for re-planning.")).toBeInTheDocument();

    await user.click(screen.getByText("Start fresh"));
    const textarea = screen.getByPlaceholderText(/describe what should change/);
    await user.type(textarea, "  needs more detail  ");

    const confirmButtons = screen.getAllByRole("button", { name: "Reject Plan" });
    await user.click(confirmButtons[confirmButtons.length - 1]);

    await waitFor(() =>
      expect(mockApi.rejectPlan).toHaveBeenCalledWith(RUN_ID, "needs more detail", "fresh"),
    );
    await waitFor(() => expect(onAction).toHaveBeenCalledTimes(1));
  });

  it("passes undefined context to rejectPlan when feedback textarea is left blank, defaulting to iterate mode", async () => {
    const user = userEvent.setup();
    render(<ActionBar runId={RUN_ID} state="AwaitingPlanApproval" onAction={vi.fn()} />);

    await user.click(screen.getByRole("button", { name: /Reject Plan/ }));
    const confirmButtons = screen.getAllByRole("button", { name: "Reject Plan" });
    await user.click(confirmButtons[confirmButtons.length - 1]);

    await waitFor(() =>
      expect(mockApi.rejectPlan).toHaveBeenCalledWith(RUN_ID, undefined, "iterate"),
    );
  });

  it("closes the reject dialog and clears feedback when Cancel is clicked", async () => {
    const user = userEvent.setup();
    render(<ActionBar runId={RUN_ID} state="AwaitingPlanApproval" onAction={vi.fn()} />);

    await user.click(screen.getByRole("button", { name: /Reject Plan/ }));
    const textarea = screen.getByPlaceholderText(/describe what should change/);
    await user.type(textarea, "draft feedback");

    await user.click(screen.getByRole("button", { name: "Cancel" }));
    expect(screen.queryByPlaceholderText(/describe what should change/)).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /Reject Plan/ }));
    expect(screen.getByPlaceholderText(/describe what should change/)).toHaveValue("");
  });

  it("shows Approve & Complete for ReadyForHumanReview and calls approveReview on confirm", async () => {
    const user = userEvent.setup();
    const onAction = vi.fn();
    render(<ActionBar runId={RUN_ID} state="ReadyForHumanReview" onAction={onAction} />);

    await user.click(screen.getByRole("button", { name: /Approve & Complete/ }));
    await user.click(screen.getByRole("button", { name: "Complete Run" }));

    await waitFor(() => expect(mockApi.approveReview).toHaveBeenCalledWith(RUN_ID));
    await waitFor(() => expect(onAction).toHaveBeenCalledTimes(1));
  });

  it("shows Pause for an active-category state and calls pauseRun on confirm", async () => {
    const user = userEvent.setup();
    render(<ActionBar runId={RUN_ID} state="Implementing" onAction={vi.fn()} />);

    await user.click(screen.getByRole("button", { name: /Pause/ }));
    await user.click(screen.getByRole("button", { name: "Pause" }));

    await waitFor(() => expect(mockApi.pauseRun).toHaveBeenCalledWith(RUN_ID));
  });

  it("shows Retry Execution for Implementing state (in RETRY_LABELS) and calls retryStage", async () => {
    const user = userEvent.setup();
    render(<ActionBar runId={RUN_ID} state="Implementing" onAction={vi.fn()} />);

    await user.click(screen.getByRole("button", { name: /Retry Execution/ }));
    await user.click(screen.getByRole("button", { name: "Retry" }));

    await waitFor(() => expect(mockApi.retryStage).toHaveBeenCalledWith(RUN_ID));
  });

  it("does not show a Retry button for AIBlocked since it is not in RETRY_LABELS", () => {
    render(<ActionBar runId={RUN_ID} state="AIBlocked" onAction={vi.fn()} />);
    expect(screen.queryByRole("button", { name: /Retry/ })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Resume/ })).toBeInTheDocument();
  });

  it("shows Resume for AIBlocked, HumanClarificationNeeded, and Failed states and calls resumeRun", async () => {
    const user = userEvent.setup();
    for (const state of ["AIBlocked", "HumanClarificationNeeded", "Failed"]) {
      mockApi.resumeRun.mockClear();
      const { unmount } = render(<ActionBar runId={RUN_ID} state={state} onAction={vi.fn()} />);
      await user.click(screen.getByRole("button", { name: /Resume/ }));
      await user.click(screen.getByRole("button", { name: "Resume" }));
      await waitFor(() => expect(mockApi.resumeRun).toHaveBeenCalledWith(RUN_ID));
      unmount();
    }
  });

  it("shows Answer Questions for HumanClarificationNeeded and calls onScrollToQuestions", async () => {
    const user = userEvent.setup();
    const onScrollToQuestions = vi.fn();
    render(
      <ActionBar
        runId={RUN_ID}
        state="HumanClarificationNeeded"
        onAction={vi.fn()}
        onScrollToQuestions={onScrollToQuestions}
      />,
    );
    await user.click(screen.getByRole("button", { name: "Answer Questions" }));
    expect(onScrollToQuestions).toHaveBeenCalledTimes(1);
  });

  it("calls reReviewPlan with the note when Re-review Plan is confirmed", async () => {
    const user = userEvent.setup();
    render(<ActionBar runId={RUN_ID} state="AwaitingPlanApproval" onAction={vi.fn()} />);

    await user.click(screen.getByRole("button", { name: /Re-review Plan/ }));
    const noteField = screen.getByPlaceholderText(/focus on the test plan/);
    await user.type(noteField, "check risks");
    await user.click(screen.getByRole("button", { name: "Re-review" }));

    await waitFor(() => expect(mockApi.reReviewPlan).toHaveBeenCalledWith(RUN_ID, "check risks"));
  });

  it("calls revisePlan with the note when Revise Plan is confirmed", async () => {
    const user = userEvent.setup();
    render(<ActionBar runId={RUN_ID} state="AwaitingPlanApproval" onAction={vi.fn()} />);

    await user.click(screen.getByRole("button", { name: /Revise Plan/ }));
    const noteField = screen.getByPlaceholderText(/tighten the rollout step/);
    await user.type(noteField, "expand tests");
    await user.click(screen.getByRole("button", { name: "Revise" }));

    await waitFor(() => expect(mockApi.revisePlan).toHaveBeenCalledWith(RUN_ID, "expand tests"));
  });

  it("closes the confirm dialog without crashing when the action rejects", async () => {
    mockApi.approvePlan.mockRejectedValueOnce(new Error("network error"));
    const user = userEvent.setup();
    const onAction = vi.fn();
    render(<ActionBar runId={RUN_ID} state="AwaitingPlanApproval" onAction={onAction} />);

    await user.click(screen.getByRole("button", { name: /Approve Plan/ }));
    await user.click(screen.getByRole("button", { name: "Approve & Start" }));

    await waitFor(() => expect(mockApi.approvePlan).toHaveBeenCalled());
    expect(onAction).not.toHaveBeenCalled();
    expect(screen.queryByText("Approve & Start")).not.toBeInTheDocument();
  });
});
