import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ActionBar } from "./ActionBar.tsx";

// Mock the api module
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
    mockApi.approvePlan.mockResolvedValue({ ok: true, state: "Implementing" });
    mockApi.rejectPlan.mockResolvedValue({ ok: true, state: "PlanRevision" });
    mockApi.reReviewPlan.mockResolvedValue({ ok: true, runId: "run-1" });
    mockApi.revisePlan.mockResolvedValue({ ok: true, runId: "run-1" });
    mockApi.approveReview.mockResolvedValue({ ok: true, state: "Done" });
    mockApi.pauseRun.mockResolvedValue({ ok: true });
    mockApi.resumeRun.mockResolvedValue({ ok: true });
    mockApi.retryStage.mockResolvedValue({ ok: true, state: "Planning", retrying: true });
  });

  it("renders nothing when no buttons apply (Done, no optional questions)", () => {
    const { container } = render(
      <ActionBar runId="run-1" state="Done" onAction={vi.fn()} />,
    );
    expect(container.firstChild).toBeNull();
  });

  it("shows the Answer Questions button for HumanClarificationNeeded and calls onScrollToQuestions", async () => {
    const onScroll = vi.fn();
    render(
      <ActionBar
        runId="run-1"
        state="HumanClarificationNeeded"
        onAction={vi.fn()}
        onScrollToQuestions={onScroll}
      />,
    );

    const btn = screen.getByRole("button", { name: /Answer Questions/i });
    await userEvent.click(btn);
    expect(onScroll).toHaveBeenCalledOnce();

    // HumanClarificationNeeded also exposes Resume
    expect(screen.getByRole("button", { name: "Resume" })).toBeDefined();
  });

  it("shows Answer Optional Questions only when AwaitingPlanApproval and hasOptionalQuestions, and calls onScrollToQuestions", async () => {
    const onScroll = vi.fn();
    const { rerender } = render(
      <ActionBar
        runId="run-1"
        state="AwaitingPlanApproval"
        onAction={vi.fn()}
        onScrollToQuestions={onScroll}
        hasOptionalQuestions={false}
      />,
    );
    expect(screen.queryByRole("button", { name: /Answer Optional Questions/i })).toBeNull();

    rerender(
      <ActionBar
        runId="run-1"
        state="AwaitingPlanApproval"
        onAction={vi.fn()}
        onScrollToQuestions={onScroll}
        hasOptionalQuestions={true}
      />,
    );
    const btn = screen.getByRole("button", { name: /Answer Optional Questions/i });
    await userEvent.click(btn);
    expect(onScroll).toHaveBeenCalledOnce();
  });

  describe("Re-review Plan dialog", () => {
    it("calls api.reReviewPlan with a note and fires onAction on success", async () => {
      const onAction = vi.fn();
      render(<ActionBar runId="run-1" state="AwaitingPlanApproval" onAction={onAction} />);

      await userEvent.click(screen.getByRole("button", { name: /Re-review Plan/i }));
      const textarea = screen.getByPlaceholderText(/focus on the test plan/i);
      await userEvent.type(textarea, "please check the migration");
      await userEvent.click(screen.getByRole("button", { name: "Re-review" }));

      await waitFor(() => {
        expect(mockApi.reReviewPlan).toHaveBeenCalledWith("run-1", "please check the migration");
      });
      expect(onAction).toHaveBeenCalledOnce();
      // dialog should close after confirm
      expect(screen.queryByPlaceholderText(/focus on the test plan/i)).toBeNull();
    });

    it("calls api.reReviewPlan with undefined note when left blank", async () => {
      render(<ActionBar runId="run-1" state="AwaitingPlanApproval" onAction={vi.fn()} />);

      await userEvent.click(screen.getByRole("button", { name: /Re-review Plan/i }));
      await userEvent.click(screen.getByRole("button", { name: "Re-review" }));

      await waitFor(() => {
        expect(mockApi.reReviewPlan).toHaveBeenCalledWith("run-1", undefined);
      });
    });

    it("cancel closes the dialog without calling the api", async () => {
      render(<ActionBar runId="run-1" state="AwaitingPlanApproval" onAction={vi.fn()} />);

      await userEvent.click(screen.getByRole("button", { name: /Re-review Plan/i }));
      await userEvent.click(screen.getByRole("button", { name: "Cancel" }));

      expect(mockApi.reReviewPlan).not.toHaveBeenCalled();
      expect(screen.queryByPlaceholderText(/focus on the test plan/i)).toBeNull();
    });
  });

  describe("Revise Plan dialog", () => {
    it("calls api.revisePlan with a note and fires onAction on success", async () => {
      const onAction = vi.fn();
      render(<ActionBar runId="run-1" state="AwaitingPlanApproval" onAction={onAction} />);

      await userEvent.click(screen.getByRole("button", { name: /Revise Plan/i }));
      const textarea = screen.getByPlaceholderText(/tighten the rollout step/i);
      await userEvent.type(textarea, "tighten step 3");
      await userEvent.click(screen.getByRole("button", { name: "Revise" }));

      await waitFor(() => {
        expect(mockApi.revisePlan).toHaveBeenCalledWith("run-1", "tighten step 3");
      });
      expect(onAction).toHaveBeenCalledOnce();
    });

    it("calls api.revisePlan with undefined note when left blank", async () => {
      render(<ActionBar runId="run-1" state="AwaitingPlanApproval" onAction={vi.fn()} />);

      await userEvent.click(screen.getByRole("button", { name: /Revise Plan/i }));
      await userEvent.click(screen.getByRole("button", { name: "Revise" }));

      await waitFor(() => {
        expect(mockApi.revisePlan).toHaveBeenCalledWith("run-1", undefined);
      });
    });
  });

  describe("Approve Plan dialog (handleConfirm)", () => {
    it("calls api.approvePlan with a note, fires onAction, and closes the dialog", async () => {
      const onAction = vi.fn();
      render(<ActionBar runId="run-1" state="AwaitingPlanApproval" onAction={onAction} />);

      await userEvent.click(screen.getByRole("button", { name: /Approve Plan/i }));
      const textarea = screen.getByPlaceholderText(/extra context/i);
      await userEvent.type(textarea, "watch the rate limiter");
      await userEvent.click(screen.getByRole("button", { name: "Approve & Start" }));

      await waitFor(() => {
        expect(mockApi.approvePlan).toHaveBeenCalledWith("run-1", "watch the rate limiter");
      });
      expect(onAction).toHaveBeenCalledOnce();
      expect(screen.queryByPlaceholderText(/extra context/i)).toBeNull();
    });

    it("calls api.approvePlan with undefined note when left blank", async () => {
      render(<ActionBar runId="run-1" state="AwaitingPlanApproval" onAction={vi.fn()} />);

      await userEvent.click(screen.getByRole("button", { name: /Approve Plan/i }));
      await userEvent.click(screen.getByRole("button", { name: "Approve & Start" }));

      await waitFor(() => {
        expect(mockApi.approvePlan).toHaveBeenCalledWith("run-1", undefined);
      });
    });

    it("cancelling the Approve Plan dialog does not call the api", async () => {
      render(<ActionBar runId="run-1" state="AwaitingPlanApproval" onAction={vi.fn()} />);

      await userEvent.click(screen.getByRole("button", { name: /Approve Plan/i }));
      await userEvent.click(screen.getByRole("button", { name: "Cancel" }));

      expect(mockApi.approvePlan).not.toHaveBeenCalled();
    });

    it("swallows a rejected approvePlan call, never calls onAction, and still closes the dialog (handleConfirm catch)", async () => {
      mockApi.approvePlan.mockRejectedValueOnce(new Error("server exploded"));
      const onAction = vi.fn();
      render(<ActionBar runId="run-1" state="AwaitingPlanApproval" onAction={onAction} />);

      await userEvent.click(screen.getByRole("button", { name: /Approve Plan/i }));
      await userEvent.click(screen.getByRole("button", { name: "Approve & Start" }));

      await waitFor(() => {
        expect(screen.queryByPlaceholderText(/extra context/i)).toBeNull();
      });
      expect(onAction).not.toHaveBeenCalled();
    });
  });

  describe("Reject Plan custom dialog (handleRejectConfirm)", () => {
    it("opens its own modal (not the shared ConfirmDialog) with iterate/fresh toggle", async () => {
      render(<ActionBar runId="run-1" state="AwaitingPlanApproval" onAction={vi.fn()} />);

      await userEvent.click(screen.getByRole("button", { name: "Reject Plan" }));

      expect(screen.getByText(/This will reject the current plan/i)).toBeDefined();
      expect(screen.getByRole("button", { name: /Revise plan/i })).toBeDefined();
      expect(screen.getByRole("button", { name: /Start fresh/i })).toBeDefined();
    });

    it("defaults to iterate mode and sends trimmed feedback", async () => {
      const onAction = vi.fn();
      render(<ActionBar runId="run-1" state="AwaitingPlanApproval" onAction={onAction} />);

      await userEvent.click(screen.getByRole("button", { name: "Reject Plan" }));
      const textarea = screen.getByPlaceholderText(/describe what should change/i);
      await userEvent.type(textarea, "  needs more detail  ");

      const confirmButtons = screen.getAllByRole("button", { name: "Reject Plan" });
      await userEvent.click(confirmButtons[confirmButtons.length - 1]);

      await waitFor(() => {
        expect(mockApi.rejectPlan).toHaveBeenCalledWith(
          "run-1",
          "needs more detail",
          "iterate",
        );
      });
      expect(onAction).toHaveBeenCalledOnce();
    });

    it("sends undefined context when feedback is left blank", async () => {
      render(<ActionBar runId="run-1" state="AwaitingPlanApproval" onAction={vi.fn()} />);

      await userEvent.click(screen.getByRole("button", { name: "Reject Plan" }));
      const confirmButtons = screen.getAllByRole("button", { name: "Reject Plan" });
      await userEvent.click(confirmButtons[confirmButtons.length - 1]);

      await waitFor(() => {
        expect(mockApi.rejectPlan).toHaveBeenCalledWith("run-1", undefined, "iterate");
      });
    });

    it("switches to fresh mode and sends it in the call", async () => {
      render(<ActionBar runId="run-1" state="AwaitingPlanApproval" onAction={vi.fn()} />);

      await userEvent.click(screen.getByRole("button", { name: "Reject Plan" }));
      await userEvent.click(screen.getByRole("button", { name: /Start fresh/i }));

      const confirmButtons = screen.getAllByRole("button", { name: "Reject Plan" });
      await userEvent.click(confirmButtons[confirmButtons.length - 1]);

      await waitFor(() => {
        expect(mockApi.rejectPlan).toHaveBeenCalledWith("run-1", undefined, "fresh");
      });
    });

    it("cancel closes the modal, clears feedback, and resets mode without calling the api", async () => {
      render(<ActionBar runId="run-1" state="AwaitingPlanApproval" onAction={vi.fn()} />);

      await userEvent.click(screen.getByRole("button", { name: "Reject Plan" }));
      const textarea = screen.getByPlaceholderText(/describe what should change/i);
      await userEvent.type(textarea, "some feedback");
      await userEvent.click(screen.getByRole("button", { name: /Start fresh/i }));
      await userEvent.click(screen.getByRole("button", { name: "Cancel" }));

      expect(mockApi.rejectPlan).not.toHaveBeenCalled();
      expect(screen.queryByText(/This will reject the current plan/i)).toBeNull();

      // Reopen: feedback and mode should have been reset back to defaults
      await userEvent.click(screen.getByRole("button", { name: "Reject Plan" }));
      expect((screen.getByPlaceholderText(/describe what should change/i) as HTMLTextAreaElement).value).toBe("");
      const confirmButtons = screen.getAllByRole("button", { name: "Reject Plan" });
      await userEvent.click(confirmButtons[confirmButtons.length - 1]);
      await waitFor(() => {
        expect(mockApi.rejectPlan).toHaveBeenCalledWith("run-1", undefined, "iterate");
      });
    });

    it("swallows a rejected rejectPlan call, never calls onAction, and still closes the dialog (handleRejectConfirm catch)", async () => {
      mockApi.rejectPlan.mockRejectedValueOnce(new Error("network down"));
      const onAction = vi.fn();
      render(<ActionBar runId="run-1" state="AwaitingPlanApproval" onAction={onAction} />);

      await userEvent.click(screen.getByRole("button", { name: "Reject Plan" }));
      const confirmButtons = screen.getAllByRole("button", { name: "Reject Plan" });
      await userEvent.click(confirmButtons[confirmButtons.length - 1]);

      await waitFor(() => {
        expect(screen.queryByText(/This will reject the current plan/i)).toBeNull();
      });
      expect(onAction).not.toHaveBeenCalled();
    });

    it("clicking the backdrop cancels the reject dialog", async () => {
      const { container } = render(
        <ActionBar runId="run-1" state="AwaitingPlanApproval" onAction={vi.fn()} />,
      );

      await userEvent.click(screen.getByRole("button", { name: "Reject Plan" }));
      const backdrop = container.querySelector(".fixed.inset-0 > .absolute.inset-0");
      expect(backdrop).not.toBeNull();
      await userEvent.click(backdrop as Element);

      expect(screen.queryByText(/This will reject the current plan/i)).toBeNull();
      expect(mockApi.rejectPlan).not.toHaveBeenCalled();
    });
  });

  describe("Approve & Complete", () => {
    it("calls api.approveReview and fires onAction", async () => {
      const onAction = vi.fn();
      render(<ActionBar runId="run-1" state="ReadyForHumanReview" onAction={onAction} />);

      await userEvent.click(screen.getByRole("button", { name: /Approve & Complete/i }));
      await userEvent.click(screen.getByRole("button", { name: "Complete Run" }));

      await waitFor(() => {
        expect(mockApi.approveReview).toHaveBeenCalledWith("run-1");
      });
      expect(onAction).toHaveBeenCalledOnce();
    });
  });

  describe("Pause (active category)", () => {
    it("shows for an active-category state and calls api.pauseRun", async () => {
      const onAction = vi.fn();
      render(<ActionBar runId="run-1" state="Implementing" onAction={onAction} />);

      await userEvent.click(screen.getByRole("button", { name: "Pause" }));
      const confirmButtons = screen.getAllByRole("button", { name: "Pause" });
      await userEvent.click(confirmButtons[confirmButtons.length - 1]);

      await waitFor(() => {
        expect(mockApi.pauseRun).toHaveBeenCalledWith("run-1");
      });
      expect(onAction).toHaveBeenCalledOnce();
    });

    it("does not show Pause for a non-active state like AwaitingPlanApproval", () => {
      render(<ActionBar runId="run-1" state="AwaitingPlanApproval" onAction={vi.fn()} />);
      expect(screen.queryByRole("button", { name: "Pause" })).toBeNull();
    });
  });

  describe("Resume", () => {
    it.each(["AIBlocked", "HumanClarificationNeeded", "Failed"])(
      "shows Resume for state=%s and calls api.resumeRun",
      async (state) => {
        const onAction = vi.fn();
        render(<ActionBar runId="run-1" state={state} onAction={onAction} />);

        await userEvent.click(screen.getByRole("button", { name: "Resume" }));
        const confirmButtons = screen.getAllByRole("button", { name: "Resume" });
        await userEvent.click(confirmButtons[confirmButtons.length - 1]);

        await waitFor(() => {
          expect(mockApi.resumeRun).toHaveBeenCalledWith("run-1");
        });
        expect(onAction).toHaveBeenCalledOnce();
      },
    );

    it("does not show Resume for an unrelated state", () => {
      render(<ActionBar runId="run-1" state="Done" onAction={vi.fn()} />);
      expect(screen.queryByRole("button", { name: "Resume" })).toBeNull();
    });
  });

  describe("Retry button (dynamic label from RETRY_LABELS)", () => {
    const cases: Array<[string, string]> = [
      ["Todo", "Start Run"],
      ["Planning", "Retry Planning"],
      ["PlanRevision", "Retry Plan Revision"],
      ["PlanReview", "Retry Plan Review"],
      ["Implementing", "Retry Execution"],
      ["AIReview", "Retry Code Review"],
      ["AddressingReview", "Retry Remediation"],
    ];

    it.each(cases)("shows the correct label for state=%s and calls api.retryStage", async (state, label) => {
      const onAction = vi.fn();
      render(<ActionBar runId="run-1" state={state} onAction={onAction} />);

      const btn = screen.getByRole("button", { name: label });
      await userEvent.click(btn);

      // The dialog title should match the same label text
      const dialogTitle = screen.getByRole("heading", { name: label });
      expect(dialogTitle).toBeDefined();

      await userEvent.click(screen.getByRole("button", { name: "Retry" }));

      await waitFor(() => {
        expect(mockApi.retryStage).toHaveBeenCalledWith("run-1");
      });
      expect(onAction).toHaveBeenCalledOnce();
    });

    it("does not show a Retry button for a state outside RETRY_LABELS", () => {
      render(<ActionBar runId="run-1" state="AwaitingPlanApproval" onAction={vi.fn()} />);
      expect(screen.queryByRole("button", { name: /^Retry/ })).toBeNull();
      expect(screen.queryByRole("button", { name: "Start Run" })).toBeNull();
    });
  });

  describe("Multiple buttons together", () => {
    it("AwaitingPlanApproval with optional questions shows all five contextual buttons", () => {
      render(
        <ActionBar
          runId="run-1"
          state="AwaitingPlanApproval"
          onAction={vi.fn()}
          onScrollToQuestions={vi.fn()}
          hasOptionalQuestions={true}
        />,
      );

      expect(screen.getByRole("button", { name: /Answer Optional Questions/i })).toBeDefined();
      expect(screen.getByRole("button", { name: /Re-review Plan/i })).toBeDefined();
      expect(screen.getByRole("button", { name: /Revise Plan/i })).toBeDefined();
      expect(screen.getByRole("button", { name: /Approve Plan/i })).toBeDefined();
      expect(screen.getByRole("button", { name: "Reject Plan" })).toBeDefined();
    });

    it("HumanClarificationNeeded shows both Answer Questions and Resume", () => {
      render(
        <ActionBar
          runId="run-1"
          state="HumanClarificationNeeded"
          onAction={vi.fn()}
          onScrollToQuestions={vi.fn()}
        />,
      );
      const bar = screen.getByRole("button", { name: /Answer Questions/i }).closest("div");
      expect(bar).not.toBeNull();
      expect(within(bar as HTMLElement).getByRole("button", { name: "Resume" })).toBeDefined();
    });
  });
});
