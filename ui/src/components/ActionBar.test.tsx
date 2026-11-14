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
    for (const key of Object.keys(mockApi)) {
      mockApi[key].mockResolvedValue({ ok: true });
    }
  });

  it("renders nothing for a terminal state with no applicable actions", () => {
    const { container } = render(<ActionBar runId="run-1" state="Done" onAction={vi.fn()} />);
    expect(container.firstChild).toBeNull();
  });

  it("approves the plan with a note and calls onAction", async () => {
    const onAction = vi.fn();
    render(<ActionBar runId="run-1" state="AwaitingPlanApproval" onAction={onAction} />);

    await userEvent.click(screen.getByRole("button", { name: /Approve Plan/ }));
    await userEvent.type(screen.getByRole("textbox"), "watch the edge cases");
    await userEvent.click(screen.getByRole("button", { name: "Approve & Start" }));

    expect(mockApi.approvePlan).toHaveBeenCalledWith("run-1", "watch the edge cases");
    expect(onAction).toHaveBeenCalledOnce();
  });

  it("does not call onAction when the approve action rejects", async () => {
    mockApi.approvePlan.mockRejectedValue(new Error("fail"));
    const onAction = vi.fn();
    render(<ActionBar runId="run-1" state="AwaitingPlanApproval" onAction={onAction} />);

    await userEvent.click(screen.getByRole("button", { name: /Approve Plan/ }));
    await userEvent.click(screen.getByRole("button", { name: "Approve & Start" }));

    expect(onAction).not.toHaveBeenCalled();
    // dialog should have closed despite the failure
    expect(screen.queryByText("This will approve the current plan and start implementation. The AI agent will begin coding.")).toBeNull();
  });

  it("opens the custom reject dialog, switches modes, and submits trimmed feedback", async () => {
    const onAction = vi.fn();
    render(<ActionBar runId="run-1" state="AwaitingPlanApproval" onAction={onAction} />);

    await userEvent.click(screen.getAllByRole("button", { name: "Reject Plan" })[0]);
    expect(screen.getByText("This will reject the current plan and send it back for re-planning.")).toBeDefined();

    await userEvent.click(screen.getByText("Start fresh"));
    await userEvent.type(screen.getByPlaceholderText(/describe what should change/), "  use OAuth2  ");
    const confirmButtons = screen.getAllByRole("button", { name: "Reject Plan" });
    await userEvent.click(confirmButtons[confirmButtons.length - 1]);

    expect(mockApi.rejectPlan).toHaveBeenCalledWith("run-1", "use OAuth2", "fresh");
    expect(onAction).toHaveBeenCalledOnce();
  });

  it("sends undefined context when the reject feedback is left blank", async () => {
    render(<ActionBar runId="run-1" state="AwaitingPlanApproval" onAction={vi.fn()} />);

    await userEvent.click(screen.getAllByRole("button", { name: "Reject Plan" })[0]);
    const confirmButtons = screen.getAllByRole("button", { name: "Reject Plan" });
    await userEvent.click(confirmButtons[confirmButtons.length - 1]);

    expect(mockApi.rejectPlan).toHaveBeenCalledWith("run-1", undefined, "iterate");
  });

  it("cancels the reject dialog by clicking the backdrop", async () => {
    const { container } = render(
      <ActionBar runId="run-1" state="AwaitingPlanApproval" onAction={vi.fn()} />,
    );

    await userEvent.click(screen.getAllByRole("button", { name: "Reject Plan" })[0]);
    const backdrop = container.querySelector(".absolute.inset-0");
    await userEvent.click(backdrop!);

    expect(screen.queryByText("Feedback (optional)")).toBeNull();
    expect(mockApi.rejectPlan).not.toHaveBeenCalled();
  });

  it("re-selecting the already-active reject mode keeps it as iterate", async () => {
    render(<ActionBar runId="run-1" state="AwaitingPlanApproval" onAction={vi.fn()} />);

    await userEvent.click(screen.getAllByRole("button", { name: "Reject Plan" })[0]);
    await userEvent.click(screen.getByText("Revise plan"));
    const confirmButtons = screen.getAllByRole("button", { name: "Reject Plan" });
    await userEvent.click(confirmButtons[confirmButtons.length - 1]);

    expect(mockApi.rejectPlan).toHaveBeenCalledWith("run-1", undefined, "iterate");
  });

  it("cancels the reject dialog via the Cancel button", async () => {
    render(<ActionBar runId="run-1" state="AwaitingPlanApproval" onAction={vi.fn()} />);

    await userEvent.click(screen.getAllByRole("button", { name: "Reject Plan" })[0]);
    await userEvent.click(screen.getByRole("button", { name: "Cancel" }));

    expect(mockApi.rejectPlan).not.toHaveBeenCalled();
    expect(screen.queryByText("Feedback (optional)")).toBeNull();
  });

  it("shows Approve & Complete for ReadyForHumanReview and calls approveReview", async () => {
    const onAction = vi.fn();
    render(<ActionBar runId="run-1" state="ReadyForHumanReview" onAction={onAction} />);

    await userEvent.click(screen.getByRole("button", { name: /Approve & Complete/ }));
    await userEvent.click(screen.getByRole("button", { name: "Complete Run" }));

    expect(mockApi.approveReview).toHaveBeenCalledWith("run-1");
    expect(onAction).toHaveBeenCalledOnce();
  });

  it("shows Pause for an active-category state and calls pauseRun", async () => {
    render(<ActionBar runId="run-1" state="Implementing" onAction={vi.fn()} />);

    await userEvent.click(screen.getAllByRole("button", { name: "Pause" })[0]);
    const confirmButtons = screen.getAllByRole("button", { name: "Pause" });
    await userEvent.click(confirmButtons[confirmButtons.length - 1]);

    expect(mockApi.pauseRun).toHaveBeenCalledWith("run-1");
  });

  it.each(["AIBlocked", "HumanClarificationNeeded", "Failed"])(
    "shows Resume for %s and calls resumeRun",
    async (state) => {
      render(<ActionBar runId="run-1" state={state} onAction={vi.fn()} />);

      await userEvent.click(screen.getAllByRole("button", { name: "Resume" })[0]);
      const confirmButtons = screen.getAllByRole("button", { name: "Resume" });
      await userEvent.click(confirmButtons[confirmButtons.length - 1]);

      expect(mockApi.resumeRun).toHaveBeenCalledWith("run-1");
    },
  );

  it.each(["Todo", "Planning", "PlanRevision", "PlanReview", "Implementing", "AIReview", "AddressingReview"])(
    "shows a retry action for %s and calls retryStage",
    async (state) => {
      render(<ActionBar runId="run-1" state={state} onAction={vi.fn()} />);

      const retryButtons = screen.getAllByRole("button");
      const retryBtn = retryButtons.find((b) => /Retry|Start Run/.test(b.textContent ?? ""));
      expect(retryBtn).toBeDefined();
      await userEvent.click(retryBtn!);

      const confirmBtn = screen.getByRole("button", { name: "Retry" });
      await userEvent.click(confirmBtn);

      expect(mockApi.retryStage).toHaveBeenCalledWith("run-1");
    },
  );

  it("shows the Answer Questions button for HumanClarificationNeeded and calls onScrollToQuestions", async () => {
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

  it("shows the Answer Optional Questions button only when hasOptionalQuestions is true", () => {
    const { rerender } = render(
      <ActionBar runId="run-1" state="AwaitingPlanApproval" onAction={vi.fn()} hasOptionalQuestions />,
    );
    expect(screen.getByText("Answer Optional Questions")).toBeDefined();

    rerender(
      <ActionBar runId="run-1" state="AwaitingPlanApproval" onAction={vi.fn()} hasOptionalQuestions={false} />,
    );
    expect(screen.queryByText("Answer Optional Questions")).toBeNull();
  });

  it("opens the re-review dialog and calls reReviewPlan with the note", async () => {
    render(<ActionBar runId="run-1" state="AwaitingPlanApproval" onAction={vi.fn()} />);

    await userEvent.click(screen.getByRole("button", { name: "Re-review Plan" }));
    const textarea = screen.getAllByRole("textbox")[0];
    await userEvent.type(textarea, "double check auth");
    await userEvent.click(screen.getByRole("button", { name: "Re-review" }));

    expect(mockApi.reReviewPlan).toHaveBeenCalledWith("run-1", "double check auth");
  });

  it("opens the revise-plan dialog and calls revisePlan", async () => {
    render(<ActionBar runId="run-1" state="AwaitingPlanApproval" onAction={vi.fn()} />);

    await userEvent.click(screen.getByRole("button", { name: "Revise Plan" }));
    await userEvent.click(screen.getByRole("button", { name: "Revise" }));

    expect(mockApi.revisePlan).toHaveBeenCalledWith("run-1", undefined);
  });
});
