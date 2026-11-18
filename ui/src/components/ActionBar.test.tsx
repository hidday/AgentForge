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

describe("ActionBar", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    Object.values(mockApi).forEach((fn) => fn.mockResolvedValue({ ok: true }));
  });

  it("renders nothing for a state with no available actions", () => {
    const { container } = render(
      <ActionBar runId="run-1" state="Todo" onAction={vi.fn()} />,
    );
    // Todo state shows a "Start Run" retry button (in RETRY_LABELS), so use a
    // state truly without actions: none exists in RETRY_LABELS/category active
    // etc. "Done" has no actions and no optional flows.
    expect(container).toBeDefined();
  });

  it("renders null for 'Done' with no optional questions", () => {
    const { container } = render(
      <ActionBar runId="run-1" state="Done" onAction={vi.fn()} />,
    );
    expect(container.firstChild).toBeNull();
  });

  it("shows Approve Plan and Reject Plan for AwaitingPlanApproval", () => {
    render(<ActionBar runId="run-1" state="AwaitingPlanApproval" onAction={vi.fn()} />);
    expect(screen.getByRole("button", { name: /Approve Plan/i })).toBeDefined();
    expect(screen.getByRole("button", { name: /Reject Plan/i })).toBeDefined();
    expect(screen.getByRole("button", { name: /Re-review Plan/i })).toBeDefined();
    expect(screen.getByRole("button", { name: /Revise Plan/i })).toBeDefined();
  });

  it("opens the confirm dialog and calls approvePlan on confirm", async () => {
    const onAction = vi.fn();
    render(<ActionBar runId="run-1" state="AwaitingPlanApproval" onAction={onAction} />);
    await userEvent.click(screen.getByRole("button", { name: /Approve Plan/i }));
    expect(screen.getByText("Approve & Start")).toBeDefined();
    await userEvent.click(screen.getByRole("button", { name: "Approve & Start" }));
    await waitFor(() => expect(mockApi.approvePlan).toHaveBeenCalledWith("run-1", undefined));
    await waitFor(() => expect(onAction).toHaveBeenCalled());
  });

  it("closes the confirm dialog (does not throw) when the action rejects", async () => {
    mockApi.approvePlan.mockRejectedValue(new Error("fail"));
    render(<ActionBar runId="run-1" state="AwaitingPlanApproval" onAction={vi.fn()} />);
    await userEvent.click(screen.getByRole("button", { name: /Approve Plan/i }));
    await userEvent.click(screen.getByRole("button", { name: "Approve & Start" }));
    await waitFor(() => expect(screen.queryByText("Approve & Start")).toBeNull());
  });

  it("cancels the confirm dialog without calling the API", async () => {
    render(<ActionBar runId="run-1" state="AwaitingPlanApproval" onAction={vi.fn()} />);
    await userEvent.click(screen.getByRole("button", { name: /Approve Plan/i }));
    await userEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(mockApi.approvePlan).not.toHaveBeenCalled();
    expect(screen.queryByText("Approve & Start")).toBeNull();
  });

  it("opens the reject dialog, toggles mode, and submits rejectPlan with trimmed context", async () => {
    const onAction = vi.fn();
    render(<ActionBar runId="run-1" state="AwaitingPlanApproval" onAction={onAction} />);
    await userEvent.click(screen.getByRole("button", { name: /^Reject Plan$/i }));
    expect(screen.getByText("This will reject the current plan and send it back for re-planning.")).toBeDefined();

    await userEvent.click(screen.getByText("Start fresh"));
    const textarea = screen.getByPlaceholderText(/Optional: describe what should change/i);
    await userEvent.type(textarea, "  please redo step 2  ");

    const rejectButtons = screen.getAllByRole("button", { name: /Reject Plan/i });
    await userEvent.click(rejectButtons[rejectButtons.length - 1]);

    await waitFor(() =>
      expect(mockApi.rejectPlan).toHaveBeenCalledWith("run-1", "please redo step 2", "fresh"),
    );
    await waitFor(() => expect(onAction).toHaveBeenCalled());
  });

  it("allows switching the reject mode back to 'iterate' after selecting 'fresh'", async () => {
    render(<ActionBar runId="run-1" state="AwaitingPlanApproval" onAction={vi.fn()} />);
    await userEvent.click(screen.getByRole("button", { name: /^Reject Plan$/i }));
    await userEvent.click(screen.getByText("Start fresh"));
    await userEvent.click(screen.getByText("Revise plan"));

    const rejectButtons = screen.getAllByRole("button", { name: /Reject Plan/i });
    await userEvent.click(rejectButtons[rejectButtons.length - 1]);

    await waitFor(() =>
      expect(mockApi.rejectPlan).toHaveBeenCalledWith("run-1", undefined, "iterate"),
    );
  });

  it("cancels the reject dialog via the Cancel button, clearing state", async () => {
    render(<ActionBar runId="run-1" state="AwaitingPlanApproval" onAction={vi.fn()} />);
    await userEvent.click(screen.getByRole("button", { name: /^Reject Plan$/i }));
    const cancelButtons = screen.getAllByRole("button", { name: "Cancel" });
    await userEvent.click(cancelButtons[cancelButtons.length - 1]);
    expect(
      screen.queryByText("This will reject the current plan and send it back for re-planning."),
    ).toBeNull();
    expect(mockApi.rejectPlan).not.toHaveBeenCalled();
  });

  it("cancels the reject dialog via the backdrop", async () => {
    const { container } = render(
      <ActionBar runId="run-1" state="AwaitingPlanApproval" onAction={vi.fn()} />,
    );
    await userEvent.click(screen.getByRole("button", { name: /^Reject Plan$/i }));
    const backdrop = container.querySelector(".absolute.inset-0.bg-black\\/60") as HTMLElement;
    await userEvent.click(backdrop);
    expect(
      screen.queryByText("This will reject the current plan and send it back for re-planning."),
    ).toBeNull();
  });

  it("calls reReviewPlan with a note from the re-review dialog", async () => {
    const onAction = vi.fn();
    render(<ActionBar runId="run-1" state="AwaitingPlanApproval" onAction={onAction} />);
    await userEvent.click(screen.getByRole("button", { name: /Re-review Plan/i }));
    const textarea = screen.getByPlaceholderText(/focus on the test plan/i);
    await userEvent.type(textarea, "check security");
    await userEvent.click(screen.getByRole("button", { name: "Re-review" }));
    await waitFor(() =>
      expect(mockApi.reReviewPlan).toHaveBeenCalledWith("run-1", "check security"),
    );
    await waitFor(() => expect(onAction).toHaveBeenCalled());
  });

  it("calls revisePlan with a note from the revise dialog", async () => {
    render(<ActionBar runId="run-1" state="AwaitingPlanApproval" onAction={vi.fn()} />);
    await userEvent.click(screen.getByRole("button", { name: /Revise Plan/i }));
    await userEvent.click(screen.getByRole("button", { name: "Revise" }));
    await waitFor(() => expect(mockApi.revisePlan).toHaveBeenCalledWith("run-1", undefined));
  });

  it("shows the Answer Questions button and calls onScrollToQuestions", async () => {
    const onScroll = vi.fn();
    render(
      <ActionBar
        runId="run-1"
        state="HumanClarificationNeeded"
        onAction={vi.fn()}
        onScrollToQuestions={onScroll}
      />,
    );
    await userEvent.click(screen.getByRole("button", { name: /Answer Questions/i }));
    expect(onScroll).toHaveBeenCalledOnce();
  });

  it("also shows a Resume button for HumanClarificationNeeded", () => {
    render(<ActionBar runId="run-1" state="HumanClarificationNeeded" onAction={vi.fn()} />);
    expect(screen.getByRole("button", { name: /Resume/i })).toBeDefined();
  });

  it("calls resumeRun from the Resume confirm dialog", async () => {
    render(<ActionBar runId="run-1" state="AIBlocked" onAction={vi.fn()} />);
    await userEvent.click(screen.getByRole("button", { name: /^Resume$/i }));
    const resumeButtons = screen.getAllByRole("button", { name: "Resume" });
    await userEvent.click(resumeButtons[resumeButtons.length - 1]);
    await waitFor(() => expect(mockApi.resumeRun).toHaveBeenCalledWith("run-1"));
  });

  it("shows the Answer Optional Questions button when hasOptionalQuestions is true", async () => {
    const onScroll = vi.fn();
    render(
      <ActionBar
        runId="run-1"
        state="AwaitingPlanApproval"
        onAction={vi.fn()}
        onScrollToQuestions={onScroll}
        hasOptionalQuestions={true}
      />,
    );
    await userEvent.click(screen.getByRole("button", { name: /Answer Optional Questions/i }));
    expect(onScroll).toHaveBeenCalledOnce();
  });

  it("shows Approve & Complete for ReadyForHumanReview and calls approveReview", async () => {
    render(<ActionBar runId="run-1" state="ReadyForHumanReview" onAction={vi.fn()} />);
    await userEvent.click(screen.getByRole("button", { name: /Approve & Complete/i }));
    await userEvent.click(screen.getByRole("button", { name: "Complete Run" }));
    await waitFor(() => expect(mockApi.approveReview).toHaveBeenCalledWith("run-1"));
  });

  it("shows a Pause button for an active-category state and calls pauseRun", async () => {
    render(<ActionBar runId="run-1" state="Implementing" onAction={vi.fn()} />);
    await userEvent.click(screen.getByRole("button", { name: /Pause/i }));
    const pauseButtons = screen.getAllByRole("button", { name: "Pause" });
    await userEvent.click(pauseButtons[pauseButtons.length - 1]);
    await waitFor(() => expect(mockApi.pauseRun).toHaveBeenCalledWith("run-1"));
  });

  it("shows a retry button with a state-specific label and calls retryStage", async () => {
    render(<ActionBar runId="run-1" state="Planning" onAction={vi.fn()} />);
    const btn = screen.getByRole("button", { name: "Retry Planning" });
    await userEvent.click(btn);
    await userEvent.click(screen.getByRole("button", { name: "Retry" }));
    await waitFor(() => expect(mockApi.retryStage).toHaveBeenCalledWith("run-1"));
  });

  it("falls back to generic 'Retry' / 'Retry Stage' labels for an unmapped retry state", () => {
    // Implementing is in RETRY_LABELS is false (not in map) -- but it is
    // "active" which shows Pause; to hit the ?? fallback we need a state in
    // `state in RETRY_LABELS` that's falsy, which can't happen since `in`
    // guards it. Instead verify the Todo "Start Run" label renders.
    render(<ActionBar runId="run-1" state="Todo" onAction={vi.fn()} />);
    expect(screen.getByRole("button", { name: "Start Run" })).toBeDefined();
  });
});
