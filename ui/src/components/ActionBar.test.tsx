import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

vi.mock("@/api/client.ts", () => ({
  api: {
    approvePlan: vi.fn(),
    rejectPlan: vi.fn(),
    approveReview: vi.fn(),
    pauseRun: vi.fn(),
    resumeRun: vi.fn(),
    retryStage: vi.fn(),
    reReviewPlan: vi.fn(),
    revisePlan: vi.fn(),
  },
}));
vi.mock("@/lib/stateColors.ts", () => ({
  getStateCategory: vi.fn(),
}));

import { ActionBar } from "./ActionBar.tsx";
import { api } from "@/api/client.ts";
import { getStateCategory } from "@/lib/stateColors.ts";

const mockApi = api as unknown as Record<string, ReturnType<typeof vi.fn>>;
const mockGetStateCategory = getStateCategory as unknown as ReturnType<typeof vi.fn>;

const RUN_ID = "run-1";
const onAction = vi.fn();

describe("ActionBar", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetStateCategory.mockReturnValue("idle");
    for (const fn of Object.values(mockApi)) fn.mockResolvedValue(undefined);
  });

  it("renders nothing when no action applies to the current state", () => {
    const { container } = render(
      <ActionBar runId={RUN_ID} state="Done" onAction={onAction} />,
    );
    expect(container.firstChild).toBeNull();
  });

  it("shows Approve Plan and Reject Plan for AwaitingPlanApproval, plus re-review/revise buttons", () => {
    render(<ActionBar runId={RUN_ID} state="AwaitingPlanApproval" onAction={onAction} />);
    expect(screen.getByRole("button", { name: /Approve Plan/ })).toBeDefined();
    expect(screen.getByRole("button", { name: /Reject Plan/ })).toBeDefined();
    expect(screen.getByRole("button", { name: /Re-review Plan/ })).toBeDefined();
    expect(screen.getByRole("button", { name: /Revise Plan/ })).toBeDefined();
  });

  it("shows the Answer Optional Questions button only when hasOptionalQuestions is true", () => {
    render(
      <ActionBar
        runId={RUN_ID}
        state="AwaitingPlanApproval"
        onAction={onAction}
        hasOptionalQuestions
      />,
    );
    expect(screen.getByRole("button", { name: /Answer Optional Questions/ })).toBeDefined();
  });

  it("calls onScrollToQuestions when Answer Optional Questions is clicked", async () => {
    const onScroll = vi.fn();
    render(
      <ActionBar
        runId={RUN_ID}
        state="AwaitingPlanApproval"
        onAction={onAction}
        onScrollToQuestions={onScroll}
        hasOptionalQuestions
      />,
    );
    await userEvent.click(screen.getByRole("button", { name: /Answer Optional Questions/ }));
    expect(onScroll).toHaveBeenCalledTimes(1);
  });

  it("shows the Answer Questions button for HumanClarificationNeeded and calls onScrollToQuestions", async () => {
    const onScroll = vi.fn();
    render(
      <ActionBar
        runId={RUN_ID}
        state="HumanClarificationNeeded"
        onAction={onAction}
        onScrollToQuestions={onScroll}
      />,
    );
    const btn = screen.getByRole("button", { name: /Answer Questions/ });
    await userEvent.click(btn);
    expect(onScroll).toHaveBeenCalledTimes(1);
  });

  it("opens the Approve Plan confirm dialog and calls api.approvePlan with the note on confirm", async () => {
    render(<ActionBar runId={RUN_ID} state="AwaitingPlanApproval" onAction={onAction} />);
    await userEvent.click(screen.getByRole("button", { name: /^Approve Plan$/ }));
    expect(screen.getByText("Approve & Start")).toBeDefined();
    await userEvent.type(
      screen.getByPlaceholderText(/extra context/),
      "watch for edge cases",
    );
    await userEvent.click(screen.getByRole("button", { name: "Approve & Start" }));
    expect(mockApi.approvePlan).toHaveBeenCalledWith(RUN_ID, "watch for edge cases");
    expect(onAction).toHaveBeenCalledTimes(1);
  });

  it("calls onAction after a successful Pause confirm when category is active", async () => {
    mockGetStateCategory.mockReturnValue("active");
    render(<ActionBar runId={RUN_ID} state="Planning" onAction={onAction} />);
    await userEvent.click(screen.getByRole("button", { name: "Pause" }));
    // The dialog's confirm button shares the exact label "Pause" with the toolbar
    // button that opened it, so both now match — the dialog's is rendered last.
    const pauseButtons = screen.getAllByRole("button", { name: "Pause" });
    await userEvent.click(pauseButtons[pauseButtons.length - 1]);
    expect(mockApi.pauseRun).toHaveBeenCalledWith(RUN_ID);
    expect(onAction).toHaveBeenCalledTimes(1);
  });

  it("does not call onAction when the dialog action rejects, but still closes the dialog", async () => {
    mockApi.pauseRun.mockRejectedValue(new Error("boom"));
    mockGetStateCategory.mockReturnValue("active");
    render(<ActionBar runId={RUN_ID} state="Planning" onAction={onAction} />);
    await userEvent.click(screen.getByRole("button", { name: "Pause" }));
    const pauseButtons = screen.getAllByRole("button", { name: "Pause" });
    await userEvent.click(pauseButtons[pauseButtons.length - 1]);
    expect(mockApi.pauseRun).toHaveBeenCalled();
    expect(onAction).not.toHaveBeenCalled();
    expect(screen.queryByText("This will pause the run. You can resume it later.")).toBeNull();
  });

  it.each([
    ["AIBlocked"],
    ["HumanClarificationNeeded"],
    ["Failed"],
  ])("shows Resume for %s and calls api.resumeRun on confirm", async (state) => {
    render(<ActionBar runId={RUN_ID} state={state} onAction={onAction} />);
    await userEvent.click(screen.getByRole("button", { name: "Resume" }));
    const resumeButtons = screen.getAllByRole("button", { name: "Resume" });
    await userEvent.click(resumeButtons[resumeButtons.length - 1]);
    expect(mockApi.resumeRun).toHaveBeenCalledWith(RUN_ID);
  });

  it.each([
    ["Todo", "Start Run"],
    ["Planning", "Retry Planning"],
    ["PlanRevision", "Retry Plan Revision"],
    ["PlanReview", "Retry Plan Review"],
    ["Implementing", "Retry Execution"],
    ["AIReview", "Retry Code Review"],
    ["AddressingReview", "Retry Remediation"],
  ])("shows the correct retry label for state %s and calls api.retryStage on confirm", async (state, label) => {
    render(<ActionBar runId={RUN_ID} state={state} onAction={onAction} />);
    await userEvent.click(screen.getByRole("button", { name: label }));
    await userEvent.click(screen.getByRole("button", { name: "Retry" }));
    expect(mockApi.retryStage).toHaveBeenCalledWith(RUN_ID);
  });

  it("shows Approve & Complete for ReadyForHumanReview and calls api.approveReview with no note arg", async () => {
    render(<ActionBar runId={RUN_ID} state="ReadyForHumanReview" onAction={onAction} />);
    await userEvent.click(screen.getByRole("button", { name: /Approve & Complete/ }));
    await userEvent.click(screen.getByRole("button", { name: "Complete Run" }));
    expect(mockApi.approveReview).toHaveBeenCalledWith(RUN_ID);
  });

  it("opens the custom Reject Plan dialog instead of the generic ConfirmDialog", async () => {
    render(<ActionBar runId={RUN_ID} state="AwaitingPlanApproval" onAction={onAction} />);
    await userEvent.click(screen.getByRole("button", { name: /^Reject Plan$/ }));
    expect(
      screen.getByText("This will reject the current plan and send it back for re-planning."),
    ).toBeDefined();
  });

  it("defaults to 'iterate' reject mode and submits trimmed feedback with that mode", async () => {
    render(<ActionBar runId={RUN_ID} state="AwaitingPlanApproval" onAction={onAction} />);
    await userEvent.click(screen.getByRole("button", { name: /^Reject Plan$/ }));
    await userEvent.type(
      screen.getByPlaceholderText(/describe what should change/),
      "  needs more detail  ",
    );
    const rejectButtons = screen.getAllByRole("button", { name: "Reject Plan" });
    await userEvent.click(rejectButtons[rejectButtons.length - 1]);
    expect(mockApi.rejectPlan).toHaveBeenCalledWith(RUN_ID, "needs more detail", "iterate");
  });

  it("switches to 'fresh' reject mode and submits undefined feedback when left blank", async () => {
    render(<ActionBar runId={RUN_ID} state="AwaitingPlanApproval" onAction={onAction} />);
    await userEvent.click(screen.getByRole("button", { name: /^Reject Plan$/ }));
    await userEvent.click(screen.getByText("Start fresh"));
    const rejectButtons = screen.getAllByRole("button", { name: "Reject Plan" });
    await userEvent.click(rejectButtons[rejectButtons.length - 1]);
    expect(mockApi.rejectPlan).toHaveBeenCalledWith(RUN_ID, undefined, "fresh");
  });

  it("cancels the reject dialog via the Cancel button and resets its state", async () => {
    render(<ActionBar runId={RUN_ID} state="AwaitingPlanApproval" onAction={onAction} />);
    await userEvent.click(screen.getByRole("button", { name: /^Reject Plan$/ }));
    await userEvent.type(
      screen.getByPlaceholderText(/describe what should change/),
      "some feedback",
    );
    await userEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(
      screen.queryByText("This will reject the current plan and send it back for re-planning."),
    ).toBeNull();
    expect(mockApi.rejectPlan).not.toHaveBeenCalled();
  });

  it("opens the Re-review Plan dialog and calls api.reReviewPlan with the note", async () => {
    render(<ActionBar runId={RUN_ID} state="AwaitingPlanApproval" onAction={onAction} />);
    await userEvent.click(screen.getByRole("button", { name: /Re-review Plan/ }));
    await userEvent.type(screen.getByPlaceholderText(/focus on the test plan/), "check tests");
    await userEvent.click(screen.getByRole("button", { name: "Re-review" }));
    expect(mockApi.reReviewPlan).toHaveBeenCalledWith(RUN_ID, "check tests");
  });

  it("opens the Revise Plan dialog and calls api.revisePlan with the note", async () => {
    render(<ActionBar runId={RUN_ID} state="AwaitingPlanApproval" onAction={onAction} />);
    await userEvent.click(screen.getByRole("button", { name: /Revise Plan/ }));
    await userEvent.type(screen.getByPlaceholderText(/tighten the rollout step/), "tighten it");
    await userEvent.click(screen.getByRole("button", { name: "Revise" }));
    expect(mockApi.revisePlan).toHaveBeenCalledWith(RUN_ID, "tighten it");
  });

  it("cancels the generic ConfirmDialog via onCancel without invoking the action", async () => {
    render(<ActionBar runId={RUN_ID} state="ReadyForHumanReview" onAction={onAction} />);
    await userEvent.click(screen.getByRole("button", { name: /Approve & Complete/ }));
    await userEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(mockApi.approveReview).not.toHaveBeenCalled();
    expect(
      screen.queryByText("This will mark the run as complete. Make sure you've reviewed the PR."),
    ).toBeNull();
  });
});
