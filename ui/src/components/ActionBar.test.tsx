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

  describe("AwaitingPlanApproval", () => {
    it("shows Approve Plan, Reject Plan, Re-review Plan, and Revise Plan actions", () => {
      render(<ActionBar runId="run-1" state="AwaitingPlanApproval" onAction={vi.fn()} />);
      expect(screen.getByRole("button", { name: /Approve Plan/i })).toBeDefined();
      expect(screen.getByRole("button", { name: /Reject Plan/i })).toBeDefined();
      expect(screen.getByRole("button", { name: /Re-review Plan/i })).toBeDefined();
      expect(screen.getByRole("button", { name: /Revise Plan/i })).toBeDefined();
    });

    it("shows the optional-questions button only when hasOptionalQuestions is true", () => {
      const { rerender } = render(
        <ActionBar runId="run-1" state="AwaitingPlanApproval" onAction={vi.fn()} />,
      );
      expect(screen.queryByRole("button", { name: /Answer Optional Questions/i })).toBeNull();

      rerender(
        <ActionBar
          runId="run-1"
          state="AwaitingPlanApproval"
          onAction={vi.fn()}
          hasOptionalQuestions={true}
        />,
      );
      expect(screen.getByRole("button", { name: /Answer Optional Questions/i })).toBeDefined();
    });

    it("calls onScrollToQuestions when 'Answer Optional Questions' is clicked", async () => {
      const onScroll = vi.fn();
      render(
        <ActionBar
          runId="run-1"
          state="AwaitingPlanApproval"
          onAction={vi.fn()}
          hasOptionalQuestions={true}
          onScrollToQuestions={onScroll}
        />,
      );
      await userEvent.click(screen.getByRole("button", { name: /Answer Optional Questions/i }));
      expect(onScroll).toHaveBeenCalledOnce();
    });

    it("Approve Plan opens a confirm dialog; confirming sends the note and calls onAction", async () => {
      mockApi.approvePlan.mockResolvedValue({ ok: true, state: "Implementing" });
      const onAction = vi.fn();
      render(<ActionBar runId="run-1" state="AwaitingPlanApproval" onAction={onAction} />);

      await userEvent.click(screen.getByRole("button", { name: /Approve Plan/i }));
      expect(screen.getByText(/This will approve the current plan/i)).toBeDefined();

      const textarea = screen.getByPlaceholderText(/extra context, edge cases/i);
      await userEvent.type(textarea, "watch the auth flow");

      await userEvent.click(screen.getByRole("button", { name: "Approve & Start" }));

      await waitFor(() => {
        expect(mockApi.approvePlan).toHaveBeenCalledWith("run-1", "watch the auth flow");
        expect(onAction).toHaveBeenCalledOnce();
      });
    });

    it("does not call onAction when the confirmed action rejects", async () => {
      mockApi.approvePlan.mockRejectedValue(new Error("boom"));
      const onAction = vi.fn();
      render(<ActionBar runId="run-1" state="AwaitingPlanApproval" onAction={onAction} />);

      await userEvent.click(screen.getByRole("button", { name: /Approve Plan/i }));
      await userEvent.click(screen.getByRole("button", { name: "Approve & Start" }));

      await waitFor(() => expect(mockApi.approvePlan).toHaveBeenCalled());
      expect(onAction).not.toHaveBeenCalled();
      // Dialog should close afterward regardless of error.
      expect(screen.queryByText(/This will approve the current plan/i)).toBeNull();
    });

    it("cancelling the confirm dialog closes it without calling the action", async () => {
      render(<ActionBar runId="run-1" state="AwaitingPlanApproval" onAction={vi.fn()} />);
      await userEvent.click(screen.getByRole("button", { name: /Approve Plan/i }));
      await userEvent.click(screen.getByRole("button", { name: "Cancel" }));
      expect(screen.queryByText(/This will approve the current plan/i)).toBeNull();
      expect(mockApi.approvePlan).not.toHaveBeenCalled();
    });

    it("Re-review Plan opens its dialog and calls api.reReviewPlan with the note on confirm", async () => {
      mockApi.reReviewPlan.mockResolvedValue({ ok: true, runId: "run-1" });
      const onAction = vi.fn();
      render(<ActionBar runId="run-1" state="AwaitingPlanApproval" onAction={onAction} />);

      await userEvent.click(screen.getByRole("button", { name: /Re-review Plan/i }));
      expect(screen.getByText(/Run the plan reviewer again/i)).toBeDefined();

      await userEvent.click(screen.getByRole("button", { name: "Re-review" }));
      await waitFor(() => {
        expect(mockApi.reReviewPlan).toHaveBeenCalledWith("run-1", undefined);
        expect(onAction).toHaveBeenCalledOnce();
      });
    });

    it("Revise Plan opens its dialog and calls api.revisePlan on confirm", async () => {
      mockApi.revisePlan.mockResolvedValue({ ok: true, runId: "run-1" });
      const onAction = vi.fn();
      render(<ActionBar runId="run-1" state="AwaitingPlanApproval" onAction={onAction} />);

      await userEvent.click(screen.getByRole("button", { name: /Revise Plan/i }));
      expect(screen.getByText(/Run the plan reviewer and, if changes are requested/i)).toBeDefined();

      await userEvent.click(screen.getByRole("button", { name: "Revise" }));
      await waitFor(() => {
        expect(mockApi.revisePlan).toHaveBeenCalledWith("run-1", undefined);
        expect(onAction).toHaveBeenCalledOnce();
      });
    });

    describe("Reject Plan dialog", () => {
      it("opens a custom reject dialog (not the generic ConfirmDialog) defaulting to 'iterate' mode", async () => {
        render(<ActionBar runId="run-1" state="AwaitingPlanApproval" onAction={vi.fn()} />);
        await userEvent.click(screen.getByRole("button", { name: "Reject Plan" }));

        expect(
          screen.getByText(/This will reject the current plan and send it back/i),
        ).toBeDefined();
        const iterateBtn = screen.getByRole("button", { name: /^Revise plan/ });
        expect(iterateBtn.className).toContain("bg-accent");
      });

      it("switches to 'fresh' mode and back to 'iterate', reflecting the selection styling", async () => {
        render(<ActionBar runId="run-1" state="AwaitingPlanApproval" onAction={vi.fn()} />);
        await userEvent.click(screen.getByRole("button", { name: "Reject Plan" }));

        const freshBtn = screen.getByRole("button", { name: /Start fresh/i });
        const iterateBtn = screen.getByRole("button", { name: /^Revise plan/ });
        await userEvent.click(freshBtn);
        expect(freshBtn.className).toContain("bg-accent");
        expect(iterateBtn.className).not.toContain("bg-accent");

        await userEvent.click(iterateBtn);
        expect(iterateBtn.className).toContain("bg-accent");
        expect(freshBtn.className).not.toContain("bg-accent");
      });

      it("confirms rejection with trimmed feedback and the selected mode", async () => {
        mockApi.rejectPlan.mockResolvedValue({ ok: true, state: "Todo" });
        const onAction = vi.fn();
        render(<ActionBar runId="run-1" state="AwaitingPlanApproval" onAction={onAction} />);

        await userEvent.click(screen.getByRole("button", { name: "Reject Plan" }));
        await userEvent.click(screen.getByRole("button", { name: /Start fresh/i }));

        const textarea = screen.getByPlaceholderText(/describe what should change/i);
        await userEvent.type(textarea, "  needs a rethink  ");

        // There are two "Reject Plan" buttons now (the action bar trigger is gone,
        // dialog confirm remains) - query within the dialog by role and exact text.
        const confirmButtons = screen.getAllByRole("button", { name: "Reject Plan" });
        await userEvent.click(confirmButtons[confirmButtons.length - 1]!);

        await waitFor(() => {
          expect(mockApi.rejectPlan).toHaveBeenCalledWith("run-1", "needs a rethink", "fresh");
          expect(onAction).toHaveBeenCalledOnce();
        });
      });

      it("sends undefined context when feedback is empty/whitespace", async () => {
        mockApi.rejectPlan.mockResolvedValue({ ok: true, state: "Todo" });
        render(<ActionBar runId="run-1" state="AwaitingPlanApproval" onAction={vi.fn()} />);

        await userEvent.click(screen.getByRole("button", { name: "Reject Plan" }));
        const confirmButtons = screen.getAllByRole("button", { name: "Reject Plan" });
        await userEvent.click(confirmButtons[confirmButtons.length - 1]!);

        await waitFor(() => {
          expect(mockApi.rejectPlan).toHaveBeenCalledWith("run-1", undefined, "iterate");
        });
      });

      it("cancelling the reject dialog (via Cancel button) resets mode/context and closes it", async () => {
        render(<ActionBar runId="run-1" state="AwaitingPlanApproval" onAction={vi.fn()} />);
        await userEvent.click(screen.getByRole("button", { name: "Reject Plan" }));
        await userEvent.click(screen.getByRole("button", { name: /Start fresh/i }));

        const cancelBtns = screen.getAllByRole("button", { name: "Cancel" });
        await userEvent.click(cancelBtns[cancelBtns.length - 1]!);

        expect(
          screen.queryByText(/This will reject the current plan and send it back/i),
        ).toBeNull();
        expect(mockApi.rejectPlan).not.toHaveBeenCalled();
      });

      it("cancelling the reject dialog via the backdrop also closes it", async () => {
        const { container } = render(
          <ActionBar runId="run-1" state="AwaitingPlanApproval" onAction={vi.fn()} />,
        );
        await userEvent.click(screen.getByRole("button", { name: "Reject Plan" }));

        const backdrop = container.querySelector(".bg-black\\/60")!;
        await userEvent.click(backdrop);

        expect(
          screen.queryByText(/This will reject the current plan and send it back/i),
        ).toBeNull();
      });

      it("does not call onAction and keeps state reset when rejectPlan rejects", async () => {
        mockApi.rejectPlan.mockRejectedValue(new Error("network error"));
        const onAction = vi.fn();
        render(<ActionBar runId="run-1" state="AwaitingPlanApproval" onAction={onAction} />);

        await userEvent.click(screen.getByRole("button", { name: "Reject Plan" }));
        const confirmButtons = screen.getAllByRole("button", { name: "Reject Plan" });
        await userEvent.click(confirmButtons[confirmButtons.length - 1]!);

        await waitFor(() => expect(mockApi.rejectPlan).toHaveBeenCalled());
        expect(onAction).not.toHaveBeenCalled();
        expect(
          screen.queryByText(/This will reject the current plan and send it back/i),
        ).toBeNull();
      });
    });
  });

  describe("ReadyForHumanReview", () => {
    it("shows Approve & Complete and calls api.approveReview on confirm", async () => {
      mockApi.approveReview.mockResolvedValue({ ok: true, state: "Done" });
      const onAction = vi.fn();
      render(<ActionBar runId="run-1" state="ReadyForHumanReview" onAction={onAction} />);

      await userEvent.click(screen.getByRole("button", { name: /Approve & Complete/i }));
      await userEvent.click(screen.getByRole("button", { name: "Complete Run" }));

      await waitFor(() => {
        expect(mockApi.approveReview).toHaveBeenCalledWith("run-1");
        expect(onAction).toHaveBeenCalledOnce();
      });
    });
  });

  describe("active-category states", () => {
    it("shows a Pause action and calls api.pauseRun on confirm", async () => {
      mockApi.pauseRun.mockResolvedValue({ ok: true });
      const onAction = vi.fn();
      render(<ActionBar runId="run-1" state="Implementing" onAction={onAction} />);

      await userEvent.click(screen.getByRole("button", { name: /^Pause$/i }));
      const confirmButtons = screen.getAllByRole("button", { name: "Pause" });
      await userEvent.click(confirmButtons[confirmButtons.length - 1]!);

      await waitFor(() => {
        expect(mockApi.pauseRun).toHaveBeenCalledWith("run-1");
        expect(onAction).toHaveBeenCalledOnce();
      });
    });
  });

  describe("blocked/clarification states", () => {
    it.each(["AIBlocked", "HumanClarificationNeeded", "Failed"])(
      "shows a Resume action for %s and calls api.resumeRun on confirm",
      async (state) => {
        mockApi.resumeRun.mockResolvedValue({ ok: true });
        const onAction = vi.fn();
        render(<ActionBar runId="run-1" state={state} onAction={onAction} />);

        await userEvent.click(screen.getByRole("button", { name: /^Resume$/i }));
        const confirmButtons = screen.getAllByRole("button", { name: "Resume" });
        await userEvent.click(confirmButtons[confirmButtons.length - 1]!);

        await waitFor(() => {
          expect(mockApi.resumeRun).toHaveBeenCalledWith("run-1");
          expect(onAction).toHaveBeenCalledOnce();
        });
      },
    );

    it("shows 'Answer Questions' for HumanClarificationNeeded and calls onScrollToQuestions", async () => {
      const onScroll = vi.fn();
      render(
        <ActionBar
          runId="run-1"
          state="HumanClarificationNeeded"
          onAction={vi.fn()}
          onScrollToQuestions={onScroll}
        />,
      );
      await userEvent.click(screen.getByRole("button", { name: /^Answer Questions$/i }));
      expect(onScroll).toHaveBeenCalledOnce();
    });
  });

  describe("retryable states", () => {
    it("labels the retry button per-state and calls api.retryStage on confirm", async () => {
      mockApi.retryStage.mockResolvedValue({ ok: true, state: "Implementing", retrying: true });
      const onAction = vi.fn();
      render(<ActionBar runId="run-1" state="Implementing" onAction={onAction} />);

      await userEvent.click(screen.getByRole("button", { name: "Retry Execution" }));
      expect(screen.getByText(/Re-run the current stage \(Implementing\)/i)).toBeDefined();

      await userEvent.click(screen.getByRole("button", { name: "Retry" }));
      await waitFor(() => {
        expect(mockApi.retryStage).toHaveBeenCalledWith("run-1");
        expect(onAction).toHaveBeenCalledOnce();
      });
    });

    it("shows 'Start Run' as the retry label for Todo", () => {
      render(<ActionBar runId="run-1" state="Todo" onAction={vi.fn()} />);
      expect(screen.getByRole("button", { name: "Start Run" })).toBeDefined();
    });
  });
});
