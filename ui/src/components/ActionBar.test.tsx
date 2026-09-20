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
    for (const fn of Object.values(mockApi)) {
      fn.mockResolvedValue({ ok: true });
    }
  });

  it("renders nothing for a state with no available actions", () => {
    const { container } = render(
      <ActionBar runId="run-1" state="Done" onAction={vi.fn()} />,
    );

    expect(container.firstChild).toBeNull();
  });

  describe("AwaitingPlanApproval", () => {
    it("renders Approve, Reject, Re-review, and Revise actions", () => {
      render(<ActionBar runId="run-1" state="AwaitingPlanApproval" onAction={vi.fn()} />);

      expect(screen.getByRole("button", { name: /Approve Plan/ })).toBeDefined();
      expect(screen.getByRole("button", { name: /Reject Plan/ })).toBeDefined();
      expect(screen.getByRole("button", { name: /Re-review Plan/ })).toBeDefined();
      expect(screen.getByRole("button", { name: /Revise Plan/ })).toBeDefined();
    });

    it("does not render the optional-questions button by default", () => {
      render(<ActionBar runId="run-1" state="AwaitingPlanApproval" onAction={vi.fn()} />);

      expect(screen.queryByRole("button", { name: /Answer Optional Questions/ })).toBeNull();
    });

    it("renders and fires the optional-questions button when hasOptionalQuestions is true", async () => {
      const onScrollToQuestions = vi.fn();
      render(
        <ActionBar
          runId="run-1"
          state="AwaitingPlanApproval"
          onAction={vi.fn()}
          hasOptionalQuestions={true}
          onScrollToQuestions={onScrollToQuestions}
        />,
      );

      const btn = screen.getByRole("button", { name: /Answer Optional Questions/ });
      await userEvent.click(btn);
      expect(onScrollToQuestions).toHaveBeenCalledOnce();
    });

    it("approves the plan when confirmed, calling the API with the trimmed note and firing onAction", async () => {
      const onAction = vi.fn();
      render(<ActionBar runId="run-1" state="AwaitingPlanApproval" onAction={onAction} />);

      await userEvent.click(screen.getByRole("button", { name: /^Approve Plan$/ }));

      expect(screen.getByRole("heading", { name: "Approve Plan" })).toBeDefined();
      const textarea = screen.getByRole("textbox");
      await userEvent.type(textarea, "watch the migration step");

      await userEvent.click(screen.getByRole("button", { name: "Approve & Start" }));

      await waitFor(() => {
        expect(mockApi.approvePlan).toHaveBeenCalledWith(
          "run-1",
          "watch the migration step",
        );
        expect(onAction).toHaveBeenCalledOnce();
      });
      expect(screen.queryByRole("heading", { name: "Approve Plan" })).toBeNull();
    });

    it("closes the confirm dialog without calling the API when cancelled", async () => {
      const onAction = vi.fn();
      render(<ActionBar runId="run-1" state="AwaitingPlanApproval" onAction={onAction} />);

      await userEvent.click(screen.getByRole("button", { name: /^Approve Plan$/ }));
      await userEvent.click(screen.getByRole("button", { name: "Cancel" }));

      expect(screen.queryByRole("heading", { name: "Approve Plan" })).toBeNull();
      expect(mockApi.approvePlan).not.toHaveBeenCalled();
      expect(onAction).not.toHaveBeenCalled();
    });

    it("does not call onAction when the confirmed action rejects, but still closes the dialog", async () => {
      mockApi.approvePlan.mockRejectedValue(new Error("boom"));
      const onAction = vi.fn();
      render(<ActionBar runId="run-1" state="AwaitingPlanApproval" onAction={onAction} />);

      await userEvent.click(screen.getByRole("button", { name: /^Approve Plan$/ }));
      await userEvent.click(screen.getByRole("button", { name: "Approve & Start" }));

      await waitFor(() => {
        expect(screen.queryByRole("heading", { name: "Approve Plan" })).toBeNull();
      });
      expect(onAction).not.toHaveBeenCalled();
    });

    it("triggers re-review with the note via the confirm dialog", async () => {
      const onAction = vi.fn();
      render(<ActionBar runId="run-1" state="AwaitingPlanApproval" onAction={onAction} />);

      await userEvent.click(screen.getByRole("button", { name: /Re-review Plan/ }));
      expect(screen.getByRole("heading", { name: "Re-review Plan" })).toBeDefined();

      await userEvent.click(screen.getByRole("button", { name: "Re-review" }));

      await waitFor(() => {
        expect(mockApi.reReviewPlan).toHaveBeenCalledWith("run-1", undefined);
        expect(onAction).toHaveBeenCalledOnce();
      });
    });

    it("triggers revise-plan via the confirm dialog", async () => {
      const onAction = vi.fn();
      render(<ActionBar runId="run-1" state="AwaitingPlanApproval" onAction={onAction} />);

      await userEvent.click(screen.getByRole("button", { name: /Revise Plan/ }));
      expect(screen.getByRole("heading", { name: "Revise Plan" })).toBeDefined();

      await userEvent.click(screen.getByRole("button", { name: "Revise" }));

      await waitFor(() => {
        expect(mockApi.revisePlan).toHaveBeenCalledWith("run-1", undefined);
        expect(onAction).toHaveBeenCalledOnce();
      });
    });

    it("rejects the plan in iterate mode by default with trimmed feedback", async () => {
      const onAction = vi.fn();
      render(<ActionBar runId="run-1" state="AwaitingPlanApproval" onAction={onAction} />);

      const rejectButtons = screen.getAllByRole("button", { name: /^Reject Plan$/ });
      await userEvent.click(rejectButtons[0]);

      expect(screen.getByRole("heading", { name: "Reject Plan" })).toBeDefined();

      const textarea = screen.getByRole("textbox");
      await userEvent.type(textarea, "  needs more detail  ");

      const confirmButtons = screen.getAllByRole("button", { name: /^Reject Plan$/ });
      await userEvent.click(confirmButtons[confirmButtons.length - 1]);

      await waitFor(() => {
        expect(mockApi.rejectPlan).toHaveBeenCalledWith(
          "run-1",
          "needs more detail",
          "iterate",
        );
        expect(onAction).toHaveBeenCalledOnce();
      });
    });

    it("rejects the plan in fresh mode when that mode is selected, with no feedback text", async () => {
      const onAction = vi.fn();
      render(<ActionBar runId="run-1" state="AwaitingPlanApproval" onAction={onAction} />);

      await userEvent.click(screen.getAllByRole("button", { name: /^Reject Plan$/ })[0]);
      await userEvent.click(screen.getByRole("button", { name: /^Start fresh/ }));

      const confirmButtons = screen.getAllByRole("button", { name: /^Reject Plan$/ });
      await userEvent.click(confirmButtons[confirmButtons.length - 1]);

      await waitFor(() => {
        expect(mockApi.rejectPlan).toHaveBeenCalledWith("run-1", undefined, "fresh");
        expect(onAction).toHaveBeenCalledOnce();
      });
    });

    it("cancels the reject dialog without calling the API and clears the feedback field", async () => {
      const onAction = vi.fn();
      render(<ActionBar runId="run-1" state="AwaitingPlanApproval" onAction={onAction} />);

      await userEvent.click(screen.getAllByRole("button", { name: /^Reject Plan$/ })[0]);
      const textarea = screen.getByRole("textbox");
      await userEvent.type(textarea, "some feedback");

      await userEvent.click(screen.getByRole("button", { name: "Cancel" }));

      expect(screen.queryByRole("heading", { name: "Reject Plan" })).toBeNull();
      expect(mockApi.rejectPlan).not.toHaveBeenCalled();
      expect(onAction).not.toHaveBeenCalled();

      // Reopening should show a cleared textarea.
      await userEvent.click(screen.getAllByRole("button", { name: /^Reject Plan$/ })[0]);
      expect((screen.getByRole("textbox") as HTMLTextAreaElement).value).toBe("");
    });
  });

  describe("ReadyForHumanReview", () => {
    it("renders Approve & Complete and calls approveReview with no note field in the dialog", async () => {
      const onAction = vi.fn();
      render(<ActionBar runId="run-1" state="ReadyForHumanReview" onAction={onAction} />);

      await userEvent.click(screen.getByRole("button", { name: /^Approve & Complete$/ }));

      expect(screen.getByRole("heading", { name: "Approve & Complete" })).toBeDefined();
      expect(screen.queryByRole("textbox")).toBeNull();

      await userEvent.click(screen.getByRole("button", { name: "Complete Run" }));

      await waitFor(() => {
        expect(mockApi.approveReview).toHaveBeenCalledWith("run-1");
        expect(onAction).toHaveBeenCalledOnce();
      });
    });
  });

  describe("active-category states", () => {
    it("shows both Pause and the stage-specific Retry action for Implementing, and each fires its own API call", async () => {
      const onAction = vi.fn();
      render(<ActionBar runId="run-1" state="Implementing" onAction={onAction} />);

      expect(screen.getByRole("button", { name: /Pause/ })).toBeDefined();
      expect(screen.getByRole("button", { name: /Retry Execution/ })).toBeDefined();

      await userEvent.click(screen.getByRole("button", { name: /Pause/ }));
      expect(screen.getByRole("heading", { name: "Pause Run" })).toBeDefined();
      const pauseConfirmButtons = screen.getAllByRole("button", { name: "Pause" });
      await userEvent.click(pauseConfirmButtons[pauseConfirmButtons.length - 1]);

      await waitFor(() => {
        expect(mockApi.pauseRun).toHaveBeenCalledWith("run-1");
        expect(onAction).toHaveBeenCalledOnce();
      });

      await userEvent.click(screen.getByRole("button", { name: /Retry Execution/ }));
      expect(
        screen.getByRole("heading", { name: "Retry Execution" }),
      ).toBeDefined();
      await userEvent.click(screen.getByRole("button", { name: "Retry" }));

      await waitFor(() => {
        expect(mockApi.retryStage).toHaveBeenCalledWith("run-1");
        expect(onAction).toHaveBeenCalledTimes(2);
      });
    });
  });

  describe("recoverable states", () => {
    it("shows only Resume for AIBlocked and resumes the run on confirm", async () => {
      const onAction = vi.fn();
      render(<ActionBar runId="run-1" state="AIBlocked" onAction={onAction} />);

      expect(screen.getByRole("button", { name: /^Resume$/ })).toBeDefined();
      expect(screen.queryByRole("button", { name: /Pause/ })).toBeNull();
      expect(screen.queryByRole("button", { name: /Retry/ })).toBeNull();

      await userEvent.click(screen.getByRole("button", { name: /^Resume$/ }));
      expect(screen.getByRole("heading", { name: "Resume Run" })).toBeDefined();
      const resumeConfirmButtons = screen.getAllByRole("button", { name: "Resume" });
      await userEvent.click(resumeConfirmButtons[resumeConfirmButtons.length - 1]);

      await waitFor(() => {
        expect(mockApi.resumeRun).toHaveBeenCalledWith("run-1");
        expect(onAction).toHaveBeenCalledOnce();
      });
    });

    it("shows only Resume for Failed (not in RETRY_LABELS, not an active category)", () => {
      render(<ActionBar runId="run-1" state="Failed" onAction={vi.fn()} />);

      expect(screen.getByRole("button", { name: /^Resume$/ })).toBeDefined();
      expect(screen.queryByRole("button", { name: /Retry/ })).toBeNull();
      expect(screen.queryByRole("button", { name: /Pause/ })).toBeNull();
    });

    it("shows Resume and Answer Questions for HumanClarificationNeeded, firing onScrollToQuestions", async () => {
      const onScrollToQuestions = vi.fn();
      render(
        <ActionBar
          runId="run-1"
          state="HumanClarificationNeeded"
          onAction={vi.fn()}
          onScrollToQuestions={onScrollToQuestions}
        />,
      );

      expect(screen.getByRole("button", { name: /^Resume$/ })).toBeDefined();
      const answerBtn = screen.getByRole("button", { name: /^Answer Questions$/ });
      await userEvent.click(answerBtn);
      expect(onScrollToQuestions).toHaveBeenCalledOnce();
    });
  });

  describe("Todo state (Start Run)", () => {
    it("uses the Start Run retry label and calls retryStage on confirm", async () => {
      const onAction = vi.fn();
      render(<ActionBar runId="run-1" state="Todo" onAction={onAction} />);

      const startBtn = screen.getByRole("button", { name: /Start Run/ });
      await userEvent.click(startBtn);

      expect(screen.getByRole("heading", { name: "Start Run" })).toBeDefined();
      await userEvent.click(screen.getByRole("button", { name: "Retry" }));

      await waitFor(() => {
        expect(mockApi.retryStage).toHaveBeenCalledWith("run-1");
        expect(onAction).toHaveBeenCalledOnce();
      });
    });
  });

  it("shows a loading indicator on the confirm button while the action is pending", async () => {
    let resolveAction!: () => void;
    mockApi.pauseRun.mockReturnValue(
      new Promise<void>((resolve) => {
        resolveAction = resolve;
      }),
    );

    render(<ActionBar runId="run-1" state="Implementing" onAction={vi.fn()} />);

    await userEvent.click(screen.getByRole("button", { name: /^Pause$/ }));
    const pauseConfirmButtons = screen.getAllByRole("button", { name: "Pause" });
    await userEvent.click(pauseConfirmButtons[pauseConfirmButtons.length - 1]);

    expect(screen.getByText("Working...")).toBeDefined();

    resolveAction();
    await waitFor(() => {
      expect(screen.queryByText("Working...")).toBeNull();
    });
  });
});
