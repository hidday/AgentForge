import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
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

import { ActionBar } from "./ActionBar.tsx";
import { api } from "@/api/client.ts";

const mockApi = api as unknown as Record<string, ReturnType<typeof vi.fn>>;

describe("ActionBar", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    for (const fn of Object.values(mockApi)) fn.mockResolvedValue({ ok: true });
  });

  it("renders nothing for a state with no applicable actions", () => {
    const { container } = render(
      <ActionBar runId="r1" state="Done" onAction={vi.fn()} />,
    );
    expect(container.firstChild).toBeNull();
  });

  it("shows Approve Plan and Reject Plan for AwaitingPlanApproval", () => {
    render(<ActionBar runId="r1" state="AwaitingPlanApproval" onAction={vi.fn()} />);
    expect(screen.getByText("Approve Plan")).toBeDefined();
    expect(screen.getByText("Reject Plan")).toBeDefined();
    expect(screen.getByText("Re-review Plan")).toBeDefined();
    expect(screen.getByText("Revise Plan")).toBeDefined();
  });

  it("shows Approve & Complete for ReadyForHumanReview", () => {
    render(<ActionBar runId="r1" state="ReadyForHumanReview" onAction={vi.fn()} />);
    expect(screen.getByText("Approve & Complete")).toBeDefined();
  });

  it("shows Pause for an active-category state", () => {
    render(<ActionBar runId="r1" state="Implementing" onAction={vi.fn()} />);
    expect(screen.getByText("Pause")).toBeDefined();
  });

  it("shows Resume for AIBlocked, HumanClarificationNeeded, and Failed", () => {
    for (const state of ["AIBlocked", "HumanClarificationNeeded", "Failed"]) {
      const { unmount } = render(<ActionBar runId="r1" state={state} onAction={vi.fn()} />);
      expect(screen.getByText("Resume")).toBeDefined();
      unmount();
    }
  });

  it("shows the state-specific retry label for a retryable state", () => {
    render(<ActionBar runId="r1" state="Todo" onAction={vi.fn()} />);
    expect(screen.getByText("Start Run")).toBeDefined();
  });

  it("shows the Answer Questions button for HumanClarificationNeeded and wires it to onScrollToQuestions", async () => {
    const onScroll = vi.fn();
    render(
      <ActionBar
        runId="r1"
        state="HumanClarificationNeeded"
        onAction={vi.fn()}
        onScrollToQuestions={onScroll}
      />,
    );
    await userEvent.click(screen.getByText("Answer Questions"));
    expect(onScroll).toHaveBeenCalledTimes(1);
  });

  it("shows the Answer Optional Questions button only when hasOptionalQuestions is true", () => {
    const { rerender } = render(
      <ActionBar
        runId="r1"
        state="AwaitingPlanApproval"
        onAction={vi.fn()}
        hasOptionalQuestions={false}
      />,
    );
    expect(screen.queryByText("Answer Optional Questions")).toBeNull();

    rerender(
      <ActionBar
        runId="r1"
        state="AwaitingPlanApproval"
        onAction={vi.fn()}
        hasOptionalQuestions={true}
      />,
    );
    expect(screen.getByText("Answer Optional Questions")).toBeDefined();
  });

  it("opens a confirmation dialog and calls api.approvePlan with the note on confirm", async () => {
    const onAction = vi.fn();
    render(<ActionBar runId="r1" state="AwaitingPlanApproval" onAction={onAction} />);

    await userEvent.click(screen.getByText("Approve Plan"));
    const textarea = screen.getByPlaceholderText(/extra context/);
    await userEvent.type(textarea, "watch the edge case");
    await userEvent.click(screen.getByRole("button", { name: "Approve & Start" }));

    await waitFor(() =>
      expect(mockApi.approvePlan).toHaveBeenCalledWith("r1", "watch the edge case"),
    );
    expect(onAction).toHaveBeenCalledTimes(1);
  });

  it("calls api.approveReview on Approve & Complete confirm", async () => {
    render(<ActionBar runId="r1" state="ReadyForHumanReview" onAction={vi.fn()} />);
    await userEvent.click(screen.getByText("Approve & Complete"));
    await userEvent.click(screen.getByRole("button", { name: "Complete Run" }));
    await waitFor(() => expect(mockApi.approveReview).toHaveBeenCalledWith("r1"));
  });

  it("calls api.pauseRun on Pause confirm", async () => {
    render(<ActionBar runId="r1" state="Implementing" onAction={vi.fn()} />);
    await userEvent.click(screen.getByRole("button", { name: "Pause" }));
    const pauseButtons = screen.getAllByRole("button", { name: "Pause" });
    await userEvent.click(pauseButtons[pauseButtons.length - 1]);
    await waitFor(() => expect(mockApi.pauseRun).toHaveBeenCalledWith("r1"));
  });

  it("calls api.resumeRun on Resume confirm", async () => {
    render(<ActionBar runId="r1" state="AIBlocked" onAction={vi.fn()} />);
    await userEvent.click(screen.getByRole("button", { name: "Resume" }));
    const resumeButtons = screen.getAllByRole("button", { name: "Resume" });
    await userEvent.click(resumeButtons[resumeButtons.length - 1]);
    await waitFor(() => expect(mockApi.resumeRun).toHaveBeenCalledWith("r1"));
  });

  it("calls api.retryStage on retry confirm", async () => {
    render(<ActionBar runId="r1" state="Implementing" onAction={vi.fn()} />);
    await userEvent.click(screen.getByText("Retry Execution"));
    await userEvent.click(screen.getByRole("button", { name: "Retry" }));
    await waitFor(() => expect(mockApi.retryStage).toHaveBeenCalledWith("r1"));
  });

  it("calls api.reReviewPlan with the note on Re-review Plan confirm", async () => {
    render(<ActionBar runId="r1" state="AwaitingPlanApproval" onAction={vi.fn()} />);
    await userEvent.click(screen.getByText("Re-review Plan"));
    await userEvent.click(screen.getByRole("button", { name: "Re-review" }));
    await waitFor(() => expect(mockApi.reReviewPlan).toHaveBeenCalledWith("r1", undefined));
  });

  it("calls api.revisePlan on Revise Plan confirm", async () => {
    render(<ActionBar runId="r1" state="AwaitingPlanApproval" onAction={vi.fn()} />);
    await userEvent.click(screen.getByText("Revise Plan"));
    await userEvent.click(screen.getByRole("button", { name: "Revise" }));
    await waitFor(() => expect(mockApi.revisePlan).toHaveBeenCalledWith("r1", undefined));
  });

  it("closes the dialog without calling the action when cancelled", async () => {
    render(<ActionBar runId="r1" state="Implementing" onAction={vi.fn()} />);
    await userEvent.click(screen.getByRole("button", { name: "Pause" }));
    expect(screen.getByText("Pause Run")).toBeDefined();
    await userEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(mockApi.pauseRun).not.toHaveBeenCalled();
  });

  it("does not call onAction when the confirmed action rejects", async () => {
    mockApi.pauseRun.mockRejectedValue(new Error("boom"));
    const onAction = vi.fn();
    render(<ActionBar runId="r1" state="Implementing" onAction={onAction} />);
    await userEvent.click(screen.getByRole("button", { name: "Pause" }));
    const pauseButtons = screen.getAllByRole("button", { name: "Pause" });
    await userEvent.click(pauseButtons[pauseButtons.length - 1]);
    await waitFor(() => expect(mockApi.pauseRun).toHaveBeenCalled());
    expect(onAction).not.toHaveBeenCalled();
  });

  describe("reject plan dialog", () => {
    it("opens the custom reject dialog instead of the generic ConfirmDialog", async () => {
      render(<ActionBar runId="r1" state="AwaitingPlanApproval" onAction={vi.fn()} />);
      await userEvent.click(screen.getByText("Reject Plan"));
      expect(screen.getByText("Revise plan")).toBeDefined();
      expect(screen.getByText("Start fresh")).toBeDefined();
    });

    it("defaults to 'iterate' mode and submits the trimmed feedback", async () => {
      const onAction = vi.fn();
      render(<ActionBar runId="r1" state="AwaitingPlanApproval" onAction={onAction} />);
      await userEvent.click(screen.getByText("Reject Plan"));
      const textarea = screen.getByPlaceholderText(/describe what should change/);
      await userEvent.type(textarea, "  needs more validation  ");

      const confirmButtons = screen.getAllByText("Reject Plan");
      await userEvent.click(confirmButtons[confirmButtons.length - 1]);

      await waitFor(() =>
        expect(mockApi.rejectPlan).toHaveBeenCalledWith("r1", "needs more validation", "iterate"),
      );
      expect(onAction).toHaveBeenCalledTimes(1);
    });

    it("submits 'fresh' mode when selected, and undefined context when feedback is empty", async () => {
      render(<ActionBar runId="r1" state="AwaitingPlanApproval" onAction={vi.fn()} />);
      await userEvent.click(screen.getByText("Reject Plan"));
      await userEvent.click(screen.getByText("Start fresh"));

      const confirmButtons = screen.getAllByText("Reject Plan");
      await userEvent.click(confirmButtons[confirmButtons.length - 1]);

      await waitFor(() =>
        expect(mockApi.rejectPlan).toHaveBeenCalledWith("r1", undefined, "fresh"),
      );
    });

    it("allows switching back to 'iterate' mode after selecting 'fresh'", async () => {
      render(<ActionBar runId="r1" state="AwaitingPlanApproval" onAction={vi.fn()} />);
      await userEvent.click(screen.getByText("Reject Plan"));
      await userEvent.click(screen.getByText("Start fresh"));
      await userEvent.click(screen.getByText("Revise plan"));

      const confirmButtons = screen.getAllByText("Reject Plan");
      await userEvent.click(confirmButtons[confirmButtons.length - 1]);

      await waitFor(() =>
        expect(mockApi.rejectPlan).toHaveBeenCalledWith("r1", undefined, "iterate"),
      );
    });

    it("resets feedback and mode when the reject dialog is cancelled via the backdrop", async () => {
      const { container } = render(
        <ActionBar runId="r1" state="AwaitingPlanApproval" onAction={vi.fn()} />,
      );
      await userEvent.click(screen.getByText("Reject Plan"));
      const textarea = screen.getByPlaceholderText(
        /describe what should change/,
      ) as HTMLTextAreaElement;
      await userEvent.type(textarea, "some feedback");

      const backdrop = container.querySelector(".bg-black\\/60") as HTMLElement;
      await userEvent.click(backdrop);

      expect(screen.queryByText("Revise plan")).toBeNull();

      // Reopen and confirm the feedback field was reset.
      await userEvent.click(screen.getByText("Reject Plan"));
      expect(
        (screen.getByPlaceholderText(/describe what should change/) as HTMLTextAreaElement)
          .value,
      ).toBe("");
    });
  });
});
