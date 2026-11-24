import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ActionBar } from "./ActionBar.tsx";

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

import { api } from "@/api/client.ts";

const mockApi = api as unknown as Record<string, ReturnType<typeof vi.fn>>;

describe("ActionBar", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("renders nothing for a state with no available actions", () => {
    const { container } = render(<ActionBar runId="r1" state="Done" onAction={vi.fn()} />);
    expect(container.firstChild).toBeNull();
  });

  it("shows Approve Plan and Reject Plan for AwaitingPlanApproval", () => {
    render(<ActionBar runId="r1" state="AwaitingPlanApproval" onAction={vi.fn()} />);
    expect(screen.getByRole("button", { name: /Approve Plan/ })).toBeDefined();
    expect(screen.getByRole("button", { name: /Reject Plan/ })).toBeDefined();
  });

  it("opens a confirm dialog for Approve Plan and calls api.approvePlan with the note on confirm", async () => {
    mockApi.approvePlan.mockResolvedValue({ ok: true, state: "Implementing" });
    const onAction = vi.fn();
    render(<ActionBar runId="r1" state="AwaitingPlanApproval" onAction={onAction} />);

    await userEvent.click(screen.getByRole("button", { name: /Approve Plan/ }));
    expect(screen.getByText("This will approve the current plan and start implementation. The AI agent will begin coding.")).toBeDefined();

    await userEvent.type(screen.getByRole("textbox"), "watch the rollout");
    await userEvent.click(screen.getByRole("button", { name: "Approve & Start" }));

    await vi.waitFor(() => {
      expect(mockApi.approvePlan).toHaveBeenCalledWith("r1", "watch the rollout");
      expect(onAction).toHaveBeenCalledOnce();
    });
  });

  it("closes the confirm dialog on Cancel without calling the action", async () => {
    render(<ActionBar runId="r1" state="AwaitingPlanApproval" onAction={vi.fn()} />);
    await userEvent.click(screen.getByRole("button", { name: /Approve Plan/ }));
    await userEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(screen.queryByText(/This will approve the current plan/)).toBeNull();
    expect(mockApi.approvePlan).not.toHaveBeenCalled();
  });

  it("swallows a rejected confirm action and still closes the dialog", async () => {
    mockApi.pauseRun.mockRejectedValue(new Error("boom"));
    const onAction = vi.fn();
    render(<ActionBar runId="r1" state="Implementing" onAction={onAction} />);

    await userEvent.click(screen.getByRole("button", { name: /Pause/ }));
    const pauseButtons = screen.getAllByRole("button", { name: "Pause" });
    await userEvent.click(pauseButtons[pauseButtons.length - 1]);

    await vi.waitFor(() => {
      expect(mockApi.pauseRun).toHaveBeenCalled();
    });
    expect(onAction).not.toHaveBeenCalled();
    expect(screen.queryByText("Pause Run")).toBeNull();
  });

  it("opens the Reject Plan dialog, toggles mode, and submits feedback", async () => {
    mockApi.rejectPlan.mockResolvedValue({ ok: true, state: "Planning" });
    const onAction = vi.fn();
    render(<ActionBar runId="r1" state="AwaitingPlanApproval" onAction={onAction} />);

    await userEvent.click(screen.getByRole("button", { name: /Reject Plan/ }));
    expect(screen.getByText("This will reject the current plan and send it back for re-planning.")).toBeDefined();

    await userEvent.click(screen.getByText("Start fresh"));
    await userEvent.click(screen.getByText("Revise plan"));
    await userEvent.click(screen.getByText("Start fresh"));
    await userEvent.type(screen.getByPlaceholderText(/describe what should change/i), "needs rework");

    const rejectConfirmButtons = screen.getAllByRole("button", { name: "Reject Plan" });
    await userEvent.click(rejectConfirmButtons[rejectConfirmButtons.length - 1]);

    await vi.waitFor(() => {
      expect(mockApi.rejectPlan).toHaveBeenCalledWith("r1", "needs rework", "fresh");
      expect(onAction).toHaveBeenCalledOnce();
    });
  });

  it("sends undefined context when the reject feedback textarea is left blank", async () => {
    mockApi.rejectPlan.mockResolvedValue({ ok: true, state: "Planning" });
    render(<ActionBar runId="r1" state="AwaitingPlanApproval" onAction={vi.fn()} />);

    await userEvent.click(screen.getByRole("button", { name: /Reject Plan/ }));
    const rejectConfirmButtons = screen.getAllByRole("button", { name: "Reject Plan" });
    await userEvent.click(rejectConfirmButtons[rejectConfirmButtons.length - 1]);

    await vi.waitFor(() => {
      expect(mockApi.rejectPlan).toHaveBeenCalledWith("r1", undefined, "iterate");
    });
  });

  it("cancels the reject dialog and clears its state", async () => {
    render(<ActionBar runId="r1" state="AwaitingPlanApproval" onAction={vi.fn()} />);
    await userEvent.click(screen.getByRole("button", { name: /Reject Plan/ }));
    await userEvent.type(screen.getByPlaceholderText(/describe what should change/i), "abc");

    await userEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(screen.queryByText("This will reject the current plan and send it back for re-planning.")).toBeNull();
    expect(mockApi.rejectPlan).not.toHaveBeenCalled();
  });

  it("shows Approve & Complete for ReadyForHumanReview and calls approveReview with no note", async () => {
    mockApi.approveReview.mockResolvedValue({ ok: true, state: "Done" });
    render(<ActionBar runId="r1" state="ReadyForHumanReview" onAction={vi.fn()} />);

    await userEvent.click(screen.getByRole("button", { name: /Approve & Complete/ }));
    await userEvent.click(screen.getByRole("button", { name: "Complete Run" }));

    await vi.waitFor(() => expect(mockApi.approveReview).toHaveBeenCalledWith("r1"));
  });

  it("shows Resume for AIBlocked/HumanClarificationNeeded/Failed and calls resumeRun", async () => {
    mockApi.resumeRun.mockResolvedValue({ ok: true });
    render(<ActionBar runId="r1" state="AIBlocked" onAction={vi.fn()} />);

    await userEvent.click(screen.getByRole("button", { name: /Resume/ }));
    const resumeButtons = screen.getAllByRole("button", { name: "Resume" });
    await userEvent.click(resumeButtons[resumeButtons.length - 1]);

    await vi.waitFor(() => expect(mockApi.resumeRun).toHaveBeenCalledWith("r1"));
  });

  it("shows a state-specific retry label and calls retryStage", async () => {
    mockApi.retryStage.mockResolvedValue({ ok: true, state: "Implementing", retrying: true });
    render(<ActionBar runId="r1" state="Implementing" onAction={vi.fn()} />);

    const retryBtn = screen.getByRole("button", { name: "Retry Execution" });
    await userEvent.click(retryBtn);
    await userEvent.click(screen.getByRole("button", { name: "Retry" }));

    await vi.waitFor(() => expect(mockApi.retryStage).toHaveBeenCalledWith("r1"));
  });

  it("falls back to a generic 'Retry' label for a retry-eligible state with no specific mapping", () => {
    render(<ActionBar runId="r1" state="Implementing" onAction={vi.fn()} />);
    // Implementing *is* mapped ("Retry Execution"); assert the mapped label renders
    // and that no bare "Retry" button exists without a stage suffix.
    expect(screen.getByRole("button", { name: "Retry Execution" })).toBeDefined();
  });

  it("calls onScrollToQuestions when Answer Questions is clicked in HumanClarificationNeeded", async () => {
    const onScroll = vi.fn();
    render(
      <ActionBar
        runId="r1"
        state="HumanClarificationNeeded"
        onAction={vi.fn()}
        onScrollToQuestions={onScroll}
      />,
    );
    await userEvent.click(screen.getByRole("button", { name: /Answer Questions/ }));
    expect(onScroll).toHaveBeenCalledOnce();
  });

  it("shows the optional-questions button only when hasOptionalQuestions is true", () => {
    render(
      <ActionBar
        runId="r1"
        state="AwaitingPlanApproval"
        onAction={vi.fn()}
        hasOptionalQuestions={true}
      />,
    );
    expect(screen.getByRole("button", { name: /Answer Optional Questions/ })).toBeDefined();
  });

  it("opens the Re-review Plan dialog and calls reReviewPlan with the note", async () => {
    mockApi.reReviewPlan.mockResolvedValue({ ok: true, runId: "r1" });
    render(<ActionBar runId="r1" state="AwaitingPlanApproval" onAction={vi.fn()} />);

    await userEvent.click(screen.getByRole("button", { name: "Re-review Plan" }));
    await userEvent.type(screen.getByRole("textbox"), "focus on tests");
    await userEvent.click(screen.getByRole("button", { name: "Re-review" }));

    await vi.waitFor(() =>
      expect(mockApi.reReviewPlan).toHaveBeenCalledWith("r1", "focus on tests"),
    );
  });

  it("opens the Revise Plan dialog and calls revisePlan with the note", async () => {
    mockApi.revisePlan.mockResolvedValue({ ok: true, runId: "r1" });
    render(<ActionBar runId="r1" state="AwaitingPlanApproval" onAction={vi.fn()} />);

    await userEvent.click(screen.getByRole("button", { name: "Revise Plan" }));
    await userEvent.type(screen.getByRole("textbox"), "tighten rollout");
    await userEvent.click(screen.getByRole("button", { name: "Revise" }));

    await vi.waitFor(() =>
      expect(mockApi.revisePlan).toHaveBeenCalledWith("r1", "tighten rollout"),
    );
  });
});
