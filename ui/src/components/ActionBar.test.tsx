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
  });

  it("renders nothing for a state with no available actions", () => {
    const { container } = render(
      <ActionBar runId="run-1" state="Done" onAction={vi.fn()} />,
    );
    expect(container.firstChild).toBeNull();
  });

  it("shows Approve/Reject Plan plus Re-review and Revise Plan buttons for AwaitingPlanApproval", () => {
    render(<ActionBar runId="run-1" state="AwaitingPlanApproval" onAction={vi.fn()} />);
    expect(screen.getByRole("button", { name: /Approve Plan/ })).toBeDefined();
    expect(screen.getByRole("button", { name: /Reject Plan/ })).toBeDefined();
    expect(screen.getByRole("button", { name: /Re-review Plan/ })).toBeDefined();
    expect(screen.getByRole("button", { name: /Revise Plan/ })).toBeDefined();
  });

  it("shows the optional-questions button only when hasOptionalQuestions is true", () => {
    const { rerender } = render(
      <ActionBar runId="run-1" state="AwaitingPlanApproval" onAction={vi.fn()} />,
    );
    expect(screen.queryByRole("button", { name: /Answer Optional Questions/ })).toBeNull();

    rerender(
      <ActionBar
        runId="run-1"
        state="AwaitingPlanApproval"
        onAction={vi.fn()}
        hasOptionalQuestions
      />,
    );
    expect(screen.getByRole("button", { name: /Answer Optional Questions/ })).toBeDefined();
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
    await userEvent.click(screen.getByRole("button", { name: /Answer Questions/ }));
    expect(onScrollToQuestions).toHaveBeenCalledOnce();
  });

  it("shows a Resume button for AIBlocked and a Pause button for an active state", () => {
    const { rerender } = render(
      <ActionBar runId="run-1" state="AIBlocked" onAction={vi.fn()} />,
    );
    expect(screen.getByRole("button", { name: /Resume/ })).toBeDefined();

    rerender(<ActionBar runId="run-1" state="Implementing" onAction={vi.fn()} />);
    expect(screen.getByRole("button", { name: /Pause/ })).toBeDefined();
  });

  it("uses the state-specific retry label for a retryable state", () => {
    render(<ActionBar runId="run-1" state="Planning" onAction={vi.fn()} />);
    expect(screen.getByRole("button", { name: /Retry Planning/ })).toBeDefined();
  });

  it("opens a confirmation dialog on Approve Plan, calls api.approvePlan with the note, and fires onAction", async () => {
    mockApi.approvePlan.mockResolvedValue({ ok: true, state: "Implementing" });
    const onAction = vi.fn();
    render(<ActionBar runId="run-42" state="AwaitingPlanApproval" onAction={onAction} />);

    await userEvent.click(screen.getByRole("button", { name: /Approve Plan/ }));

    // Confirm dialog appears with its own confirm button
    const confirmBtn = await screen.findByRole("button", { name: "Approve & Start" });
    const textarea = screen.getByPlaceholderText(/extra context/i);
    await userEvent.type(textarea, "watch the edge cases");
    await userEvent.click(confirmBtn);

    await waitFor(() => {
      expect(mockApi.approvePlan).toHaveBeenCalledWith("run-42", "watch the edge cases");
      expect(onAction).toHaveBeenCalledOnce();
    });
  });

  it("cancelling the confirm dialog does not call the action", async () => {
    render(<ActionBar runId="run-1" state="ReadyForHumanReview" onAction={vi.fn()} />);
    await userEvent.click(screen.getByRole("button", { name: /Approve & Complete/ }));

    const cancelBtn = await screen.findByRole("button", { name: "Cancel" });
    await userEvent.click(cancelBtn);

    expect(mockApi.approveReview).not.toHaveBeenCalled();
    expect(screen.queryByRole("button", { name: "Cancel" })).toBeNull();
  });

  it("opens the custom reject dialog, switches to 'fresh' mode, and calls api.rejectPlan accordingly", async () => {
    mockApi.rejectPlan.mockResolvedValue({ ok: true, state: "Planning" });
    const onAction = vi.fn();
    render(<ActionBar runId="run-7" state="AwaitingPlanApproval" onAction={onAction} />);

    await userEvent.click(screen.getByRole("button", { name: /Reject Plan/ }));

    expect(screen.getByText("Start fresh")).toBeDefined();
    await userEvent.click(screen.getByText("Start fresh"));

    const feedbackBox = screen.getByPlaceholderText(/describe what should change/i);
    await userEvent.type(feedbackBox, "please redo step 2");

    // Two buttons are now named "Reject Plan": the toolbar trigger and the
    // dialog's own confirm button (rendered after it in the DOM).
    const rejectButtons = screen.getAllByRole("button", { name: "Reject Plan" });
    await userEvent.click(rejectButtons[rejectButtons.length - 1]);

    await waitFor(() => {
      expect(mockApi.rejectPlan).toHaveBeenCalledWith("run-7", "please redo step 2", "fresh");
      expect(onAction).toHaveBeenCalledOnce();
    });
  });

  it("defaults the reject dialog to 'iterate' mode when confirmed without switching", async () => {
    mockApi.rejectPlan.mockResolvedValue({ ok: true, state: "Planning" });
    render(<ActionBar runId="run-9" state="AwaitingPlanApproval" onAction={vi.fn()} />);

    await userEvent.click(screen.getByRole("button", { name: /Reject Plan/ }));
    const rejectButtons = screen.getAllByRole("button", { name: "Reject Plan" });
    await userEvent.click(rejectButtons[rejectButtons.length - 1]);

    await waitFor(() => {
      expect(mockApi.rejectPlan).toHaveBeenCalledWith("run-9", undefined, "iterate");
    });
  });
});
