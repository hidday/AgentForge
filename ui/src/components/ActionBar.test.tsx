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

const mockApi = api as unknown as Record<string, ReturnType<typeof vi.fn>>;

const RUN_ID = "run-1";

describe("ActionBar", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("renders nothing for a terminal state with no available actions", () => {
    const { container } = render(
      <ActionBar runId={RUN_ID} state="Done" onAction={vi.fn()} />,
    );
    expect(container.firstChild).toBeNull();
  });

  it("shows Answer Questions for HumanClarificationNeeded and calls onScrollToQuestions", async () => {
    const onScrollToQuestions = vi.fn();
    render(
      <ActionBar
        runId={RUN_ID}
        state="HumanClarificationNeeded"
        onAction={vi.fn()}
        onScrollToQuestions={onScrollToQuestions}
      />,
    );
    await userEvent.click(screen.getByRole("button", { name: /answer questions/i }));
    expect(onScrollToQuestions).toHaveBeenCalledOnce();
  });

  it("shows the Resume action for HumanClarificationNeeded and confirms via api.resumeRun", async () => {
    mockApi.resumeRun.mockResolvedValue({ ok: true });
    const onAction = vi.fn();
    render(<ActionBar runId={RUN_ID} state="HumanClarificationNeeded" onAction={onAction} />);

    await userEvent.click(screen.getByRole("button", { name: /^resume$/i }));
    expect(screen.getByText("Resume Run")).toBeDefined();

    const resumeButtons = screen.getAllByRole("button", { name: "Resume" });
    await userEvent.click(resumeButtons[resumeButtons.length - 1]!);
    await waitFor(() => {
      expect(mockApi.resumeRun).toHaveBeenCalledWith(RUN_ID);
      expect(onAction).toHaveBeenCalledOnce();
    });
  });

  it("shows Approve Plan and Reject Plan for AwaitingPlanApproval, plus Re-review and Revise buttons", () => {
    render(<ActionBar runId={RUN_ID} state="AwaitingPlanApproval" onAction={vi.fn()} />);
    expect(screen.getByRole("button", { name: /approve plan/i })).toBeDefined();
    expect(screen.getByRole("button", { name: /reject plan/i })).toBeDefined();
    expect(screen.getByRole("button", { name: /re-review plan/i })).toBeDefined();
    expect(screen.getByRole("button", { name: /revise plan/i })).toBeDefined();
  });

  it("shows the Answer Optional Questions button only when hasOptionalQuestions is true", () => {
    const { rerender } = render(
      <ActionBar runId={RUN_ID} state="AwaitingPlanApproval" onAction={vi.fn()} />,
    );
    expect(screen.queryByRole("button", { name: /answer optional questions/i })).toBeNull();

    rerender(
      <ActionBar
        runId={RUN_ID}
        state="AwaitingPlanApproval"
        onAction={vi.fn()}
        hasOptionalQuestions={true}
      />,
    );
    expect(screen.getByRole("button", { name: /answer optional questions/i })).toBeDefined();
  });

  it("opens a confirm dialog and calls api.approvePlan with a note on Approve Plan", async () => {
    mockApi.approvePlan.mockResolvedValue({ ok: true, state: "Implementing" });
    const onAction = vi.fn();
    render(<ActionBar runId={RUN_ID} state="AwaitingPlanApproval" onAction={onAction} />);

    await userEvent.click(screen.getByRole("button", { name: /approve plan/i }));
    expect(screen.getByRole("heading", { name: "Approve Plan" })).toBeDefined();

    const textarea = screen.getByPlaceholderText(/extra context/i);
    await userEvent.type(textarea, "watch the edge cases");

    await userEvent.click(screen.getByRole("button", { name: /approve & start/i }));

    await waitFor(() => {
      expect(mockApi.approvePlan).toHaveBeenCalledWith(RUN_ID, "watch the edge cases");
      expect(onAction).toHaveBeenCalledOnce();
    });
  });

  it("opens the custom reject dialog instead of the generic ConfirmDialog for Reject Plan", async () => {
    render(<ActionBar runId={RUN_ID} state="AwaitingPlanApproval" onAction={vi.fn()} />);
    await userEvent.click(screen.getByRole("button", { name: /reject plan/i }));

    expect(screen.getByText("This will reject the current plan and send it back for re-planning.")).toBeDefined();
    expect(screen.getByText("Revise plan")).toBeDefined();
    expect(screen.getByText("Start fresh")).toBeDefined();
  });

  it("submits the reject dialog with iterate mode by default and feedback text", async () => {
    mockApi.rejectPlan.mockResolvedValue({ ok: true, state: "Planning" });
    const onAction = vi.fn();
    render(<ActionBar runId={RUN_ID} state="AwaitingPlanApproval" onAction={onAction} />);

    await userEvent.click(screen.getByRole("button", { name: /reject plan/i }));
    const textarea = screen.getByPlaceholderText(/describe what should change/i);
    await userEvent.type(textarea, "needs more detail");

    const rejectConfirmButtons = screen.getAllByRole("button", { name: "Reject Plan" });
    await userEvent.click(rejectConfirmButtons[rejectConfirmButtons.length - 1]!);

    await waitFor(() => {
      expect(mockApi.rejectPlan).toHaveBeenCalledWith(RUN_ID, "needs more detail", "iterate");
      expect(onAction).toHaveBeenCalledOnce();
    });
  });

  it("submits the reject dialog in fresh mode when 'Start fresh' is selected", async () => {
    mockApi.rejectPlan.mockResolvedValue({ ok: true, state: "Planning" });
    render(<ActionBar runId={RUN_ID} state="AwaitingPlanApproval" onAction={vi.fn()} />);

    await userEvent.click(screen.getByRole("button", { name: /reject plan/i }));
    await userEvent.click(screen.getByText("Start fresh"));
    const rejectConfirmButtons = screen.getAllByRole("button", { name: "Reject Plan" });
    await userEvent.click(rejectConfirmButtons[rejectConfirmButtons.length - 1]!);

    await waitFor(() => {
      expect(mockApi.rejectPlan).toHaveBeenCalledWith(RUN_ID, undefined, "fresh");
    });
  });

  it("closes the reject dialog via Cancel and resets its fields", async () => {
    render(<ActionBar runId={RUN_ID} state="AwaitingPlanApproval" onAction={vi.fn()} />);

    await userEvent.click(screen.getByRole("button", { name: /reject plan/i }));
    const textarea = screen.getByPlaceholderText(/describe what should change/i);
    await userEvent.type(textarea, "some feedback");
    await userEvent.click(screen.getByRole("button", { name: "Cancel" }));

    expect(screen.queryByText("This will reject the current plan and send it back for re-planning.")).toBeNull();

    // Re-opening should show an empty textarea again (state was reset)
    await userEvent.click(screen.getByRole("button", { name: /reject plan/i }));
    expect(
      (screen.getByPlaceholderText(/describe what should change/i) as HTMLTextAreaElement).value,
    ).toBe("");
  });

  it("calls api.reReviewPlan with a note from the Re-review dialog", async () => {
    mockApi.reReviewPlan.mockResolvedValue({ ok: true, runId: RUN_ID });
    render(<ActionBar runId={RUN_ID} state="AwaitingPlanApproval" onAction={vi.fn()} />);

    await userEvent.click(screen.getByRole("button", { name: /re-review plan/i }));
    expect(screen.getByRole("heading", { name: "Re-review Plan" })).toBeDefined();
    await userEvent.click(screen.getByRole("button", { name: "Re-review" }));

    await waitFor(() => {
      expect(mockApi.reReviewPlan).toHaveBeenCalledWith(RUN_ID, undefined);
    });
  });

  it("calls api.revisePlan from the Revise Plan dialog", async () => {
    mockApi.revisePlan.mockResolvedValue({ ok: true, runId: RUN_ID });
    render(<ActionBar runId={RUN_ID} state="AwaitingPlanApproval" onAction={vi.fn()} />);

    await userEvent.click(screen.getByRole("button", { name: /revise plan/i }));
    await userEvent.click(screen.getByRole("button", { name: "Revise" }));

    await waitFor(() => {
      expect(mockApi.revisePlan).toHaveBeenCalledWith(RUN_ID, undefined);
    });
  });

  it("shows Approve & Complete for ReadyForHumanReview and calls api.approveReview", async () => {
    mockApi.approveReview.mockResolvedValue({ ok: true, state: "Done" });
    render(<ActionBar runId={RUN_ID} state="ReadyForHumanReview" onAction={vi.fn()} />);

    await userEvent.click(screen.getByRole("button", { name: /approve & complete/i }));
    await userEvent.click(screen.getByRole("button", { name: "Complete Run" }));

    await waitFor(() => {
      expect(mockApi.approveReview).toHaveBeenCalledWith(RUN_ID);
    });
  });

  it("shows Pause for an active-category state and calls api.pauseRun on confirm", async () => {
    mockApi.pauseRun.mockResolvedValue({ ok: true });
    render(<ActionBar runId={RUN_ID} state="Implementing" onAction={vi.fn()} />);

    await userEvent.click(screen.getByRole("button", { name: /^pause$/i }));
    const pauseButtons = screen.getAllByRole("button", { name: "Pause" });
    await userEvent.click(pauseButtons[pauseButtons.length - 1]!);

    await waitFor(() => {
      expect(mockApi.pauseRun).toHaveBeenCalledWith(RUN_ID);
    });
  });

  it("shows 'Retry Plan Revision' for the PlanRevision retry-eligible state and calls api.retryStage", async () => {
    mockApi.retryStage.mockResolvedValue({ ok: true, state: "PlanRevision", retrying: true });
    render(<ActionBar runId={RUN_ID} state="PlanRevision" onAction={vi.fn()} />);

    const retryBtn = screen.getByRole("button", { name: /retry plan revision/i });
    await userEvent.click(retryBtn);
    await userEvent.click(screen.getByRole("button", { name: "Retry" }));

    await waitFor(() => {
      expect(mockApi.retryStage).toHaveBeenCalledWith(RUN_ID);
    });
  });

  it("closes the generic confirm dialog without side effects when Cancel is clicked", async () => {
    render(<ActionBar runId={RUN_ID} state="ReadyForHumanReview" onAction={vi.fn()} />);
    await userEvent.click(screen.getByRole("button", { name: /approve & complete/i }));
    expect(screen.getByRole("heading", { name: "Approve & Complete" })).toBeDefined();
    await userEvent.click(screen.getByRole("button", { name: "Cancel" }));

    expect(screen.queryByRole("heading", { name: "Approve & Complete" })).toBeNull();
    expect(mockApi.approveReview).not.toHaveBeenCalled();
  });
});
