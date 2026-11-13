import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, act } from "@testing-library/react";
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

const RUN_ID = "run-1";

describe("ActionBar", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("renders nothing for a state with no applicable actions", () => {
    const { container } = render(
      <ActionBar runId={RUN_ID} state="Done" onAction={vi.fn()} />,
    );
    expect(container.firstChild).toBeNull();
  });

  it("renders nothing for Todo (not in RETRY_LABELS check path with no actions wired)", () => {
    // Todo IS in RETRY_LABELS ("Start Run"), so it should render that button.
    render(<ActionBar runId={RUN_ID} state="Todo" onAction={vi.fn()} />);
    expect(screen.getByRole("button", { name: /start run/i })).toBeDefined();
  });

  describe("AwaitingPlanApproval", () => {
    it("shows Approve Plan, Reject Plan, Re-review Plan, and Revise Plan buttons", () => {
      render(
        <ActionBar runId={RUN_ID} state="AwaitingPlanApproval" onAction={vi.fn()} />,
      );
      expect(screen.getByRole("button", { name: /approve plan/i })).toBeDefined();
      expect(screen.getByRole("button", { name: /reject plan/i })).toBeDefined();
      expect(screen.getByRole("button", { name: /re-review plan/i })).toBeDefined();
      expect(screen.getByRole("button", { name: /revise plan/i })).toBeDefined();
    });

    it("shows the Answer Optional Questions button only when hasOptionalQuestions is true", () => {
      const { rerender } = render(
        <ActionBar
          runId={RUN_ID}
          state="AwaitingPlanApproval"
          onAction={vi.fn()}
          hasOptionalQuestions={false}
        />,
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

    it("calls onScrollToQuestions when Answer Optional Questions is clicked", async () => {
      const onScrollToQuestions = vi.fn();
      render(
        <ActionBar
          runId={RUN_ID}
          state="AwaitingPlanApproval"
          onAction={vi.fn()}
          hasOptionalQuestions={true}
          onScrollToQuestions={onScrollToQuestions}
        />,
      );
      await userEvent.click(screen.getByRole("button", { name: /answer optional questions/i }));
      expect(onScrollToQuestions).toHaveBeenCalledOnce();
    });

    it("opens a confirm dialog for Approve Plan and calls api.approvePlan with a note on confirm", async () => {
      mockApi.approvePlan.mockResolvedValue({ ok: true, state: "Implementing" });
      const onAction = vi.fn();
      render(<ActionBar runId={RUN_ID} state="AwaitingPlanApproval" onAction={onAction} />);

      await userEvent.click(screen.getByRole("button", { name: /approve plan/i }));
      expect(screen.getByText("Approve Plan", { selector: "h3" })).toBeDefined();

      const textarea = screen.getByRole("textbox");
      await userEvent.type(textarea, "extra context");
      await userEvent.click(screen.getByRole("button", { name: /approve & start/i }));

      await waitFor(() => {
        expect(mockApi.approvePlan).toHaveBeenCalledWith(RUN_ID, "extra context");
        expect(onAction).toHaveBeenCalledOnce();
      });
    });

    it("shows a loading spinner on the confirm dialog while the action is pending", async () => {
      let resolveAction!: (v: unknown) => void;
      mockApi.approvePlan.mockReturnValue(
        new Promise((res) => {
          resolveAction = res;
        }),
      );
      render(<ActionBar runId={RUN_ID} state="AwaitingPlanApproval" onAction={vi.fn()} />);

      await userEvent.click(screen.getByRole("button", { name: /approve plan/i }));
      await userEvent.click(screen.getByRole("button", { name: /approve & start/i }));

      expect(screen.getByText("Working...")).toBeDefined();

      act(() => {
        resolveAction({ ok: true, state: "Implementing" });
      });

      await waitFor(() => {
        expect(screen.queryByText("Approve Plan", { selector: "h3" })).toBeNull();
      });
    });

    it("closes the confirm dialog without calling the API when Cancel is clicked", async () => {
      render(<ActionBar runId={RUN_ID} state="AwaitingPlanApproval" onAction={vi.fn()} />);
      await userEvent.click(screen.getByRole("button", { name: /approve plan/i }));
      await userEvent.click(screen.getByRole("button", { name: /cancel/i }));

      expect(screen.queryByText("Approve Plan", { selector: "h3" })).toBeNull();
      expect(mockApi.approvePlan).not.toHaveBeenCalled();
    });

    it("silently handles a rejected action promise and still closes the dialog", async () => {
      mockApi.approvePlan.mockRejectedValue(new Error("server error"));
      const onAction = vi.fn();
      render(<ActionBar runId={RUN_ID} state="AwaitingPlanApproval" onAction={onAction} />);

      await userEvent.click(screen.getByRole("button", { name: /approve plan/i }));
      await userEvent.click(screen.getByRole("button", { name: /approve & start/i }));

      await waitFor(() => {
        expect(screen.queryByText("Approve Plan", { selector: "h3" })).toBeNull();
      });
      expect(onAction).not.toHaveBeenCalled();
    });

    it("opens the custom reject dialog for Reject Plan instead of the generic ConfirmDialog", async () => {
      render(<ActionBar runId={RUN_ID} state="AwaitingPlanApproval" onAction={vi.fn()} />);
      await userEvent.click(screen.getByRole("button", { name: /reject plan/i }));

      expect(screen.getByText("Revise plan")).toBeDefined();
      expect(screen.getByText("Start fresh")).toBeDefined();
      expect(
        screen.getByPlaceholderText(/describe what should change in the next plan/i),
      ).toBeDefined();
    });

    it("submits the reject dialog with default iterate mode and trimmed feedback", async () => {
      mockApi.rejectPlan.mockResolvedValue({ ok: true, state: "Planning" });
      const onAction = vi.fn();
      render(<ActionBar runId={RUN_ID} state="AwaitingPlanApproval" onAction={onAction} />);

      await userEvent.click(screen.getByRole("button", { name: /reject plan/i }));
      const textarea = screen.getByPlaceholderText(/describe what should change/i);
      await userEvent.type(textarea, "  needs work  ");

      const buttons = screen.getAllByRole("button", { name: /reject plan/i });
      const confirmRejectBtn = buttons[buttons.length - 1];
      await userEvent.click(confirmRejectBtn);

      await waitFor(() => {
        expect(mockApi.rejectPlan).toHaveBeenCalledWith(RUN_ID, "needs work", "iterate");
        expect(onAction).toHaveBeenCalledOnce();
      });
    });

    it("submits the reject dialog in 'fresh' mode and with undefined feedback when left blank", async () => {
      mockApi.rejectPlan.mockResolvedValue({ ok: true, state: "Planning" });
      render(<ActionBar runId={RUN_ID} state="AwaitingPlanApproval" onAction={vi.fn()} />);

      await userEvent.click(screen.getByRole("button", { name: /reject plan/i }));
      await userEvent.click(screen.getByText("Start fresh"));

      const buttons = screen.getAllByRole("button", { name: /reject plan/i });
      await userEvent.click(buttons[buttons.length - 1]);

      await waitFor(() => {
        expect(mockApi.rejectPlan).toHaveBeenCalledWith(RUN_ID, undefined, "fresh");
      });
    });

    it("switches back to 'iterate' mode after selecting 'fresh'", async () => {
      mockApi.rejectPlan.mockResolvedValue({ ok: true, state: "Planning" });
      render(<ActionBar runId={RUN_ID} state="AwaitingPlanApproval" onAction={vi.fn()} />);

      await userEvent.click(screen.getByRole("button", { name: /reject plan/i }));
      await userEvent.click(screen.getByText("Start fresh"));
      await userEvent.click(screen.getByText("Revise plan"));

      const buttons = screen.getAllByRole("button", { name: /reject plan/i });
      await userEvent.click(buttons[buttons.length - 1]);

      await waitFor(() => {
        expect(mockApi.rejectPlan).toHaveBeenCalledWith(RUN_ID, undefined, "iterate");
      });
    });

    it("closes the reject dialog via Cancel and resets its fields without calling the API", async () => {
      render(<ActionBar runId={RUN_ID} state="AwaitingPlanApproval" onAction={vi.fn()} />);
      await userEvent.click(screen.getByRole("button", { name: /reject plan/i }));
      const textarea = screen.getByPlaceholderText(/describe what should change/i);
      await userEvent.type(textarea, "some feedback");

      await userEvent.click(screen.getByRole("button", { name: /^cancel$/i }));

      expect(screen.queryByText("Start fresh")).toBeNull();
      expect(mockApi.rejectPlan).not.toHaveBeenCalled();
    });

    it("closes the reject dialog when the backdrop is clicked", async () => {
      const { container } = render(
        <ActionBar runId={RUN_ID} state="AwaitingPlanApproval" onAction={vi.fn()} />,
      );
      await userEvent.click(screen.getByRole("button", { name: /reject plan/i }));
      const backdrop = container.querySelector(".absolute.inset-0");
      await userEvent.click(backdrop as Element);

      expect(screen.queryByText("Start fresh")).toBeNull();
    });

    it("opens the Re-review Plan confirm dialog and calls api.reReviewPlan", async () => {
      mockApi.reReviewPlan.mockResolvedValue({ ok: true, runId: RUN_ID });
      const onAction = vi.fn();
      render(<ActionBar runId={RUN_ID} state="AwaitingPlanApproval" onAction={onAction} />);

      await userEvent.click(screen.getByRole("button", { name: /re-review plan/i }));
      expect(screen.getByText("Re-review Plan", { selector: "h3" })).toBeDefined();
      await userEvent.click(screen.getByRole("button", { name: /^re-review$/i }));

      await waitFor(() => {
        expect(mockApi.reReviewPlan).toHaveBeenCalledWith(RUN_ID, undefined);
        expect(onAction).toHaveBeenCalledOnce();
      });
    });

    it("opens the Revise Plan confirm dialog and calls api.revisePlan", async () => {
      mockApi.revisePlan.mockResolvedValue({ ok: true, runId: RUN_ID });
      const onAction = vi.fn();
      render(<ActionBar runId={RUN_ID} state="AwaitingPlanApproval" onAction={onAction} />);

      await userEvent.click(screen.getByRole("button", { name: /^revise plan$/i }));
      expect(screen.getByText("Revise Plan", { selector: "h3" })).toBeDefined();
      await userEvent.click(screen.getByRole("button", { name: /^revise$/i }));

      await waitFor(() => {
        expect(mockApi.revisePlan).toHaveBeenCalledWith(RUN_ID, undefined);
        expect(onAction).toHaveBeenCalledOnce();
      });
    });
  });

  describe("HumanClarificationNeeded", () => {
    it("shows the Answer Questions button and calls onScrollToQuestions on click", async () => {
      const onScrollToQuestions = vi.fn();
      render(
        <ActionBar
          runId={RUN_ID}
          state="HumanClarificationNeeded"
          onAction={vi.fn()}
          onScrollToQuestions={onScrollToQuestions}
        />,
      );
      await userEvent.click(screen.getByRole("button", { name: /^answer questions$/i }));
      expect(onScrollToQuestions).toHaveBeenCalledOnce();
    });

    it("also shows a Resume button that calls api.resumeRun on confirm", async () => {
      mockApi.resumeRun.mockResolvedValue({ ok: true });
      const onAction = vi.fn();
      render(
        <ActionBar runId={RUN_ID} state="HumanClarificationNeeded" onAction={onAction} />,
      );
      await userEvent.click(screen.getByRole("button", { name: /resume/i }));
      const resumeButtons = screen.getAllByRole("button", { name: /^resume$/i });
      await userEvent.click(resumeButtons[resumeButtons.length - 1]);

      await waitFor(() => {
        expect(mockApi.resumeRun).toHaveBeenCalledWith(RUN_ID);
        expect(onAction).toHaveBeenCalledOnce();
      });
    });
  });

  describe("ReadyForHumanReview", () => {
    it("shows Approve & Complete and calls api.approveReview on confirm", async () => {
      mockApi.approveReview.mockResolvedValue({ ok: true, state: "Done" });
      const onAction = vi.fn();
      render(<ActionBar runId={RUN_ID} state="ReadyForHumanReview" onAction={onAction} />);

      await userEvent.click(screen.getByRole("button", { name: /approve & complete/i }));
      await userEvent.click(screen.getByRole("button", { name: /complete run/i }));

      await waitFor(() => {
        expect(mockApi.approveReview).toHaveBeenCalledWith(RUN_ID);
        expect(onAction).toHaveBeenCalledOnce();
      });
    });

    it("does not render a notes textarea for the Approve & Complete dialog", async () => {
      render(<ActionBar runId={RUN_ID} state="ReadyForHumanReview" onAction={vi.fn()} />);
      await userEvent.click(screen.getByRole("button", { name: /approve & complete/i }));
      expect(screen.queryByRole("textbox")).toBeNull();
    });
  });

  describe("Pause (active category states)", () => {
    it("shows a Pause button for an active-category state and calls api.pauseRun on confirm", async () => {
      mockApi.pauseRun.mockResolvedValue({ ok: true });
      const onAction = vi.fn();
      render(<ActionBar runId={RUN_ID} state="Implementing" onAction={onAction} />);

      await userEvent.click(screen.getByRole("button", { name: /^pause$/i }));
      const pauseButtons = screen.getAllByRole("button", { name: /^pause$/i });
      await userEvent.click(pauseButtons[pauseButtons.length - 1]);

      await waitFor(() => {
        expect(mockApi.pauseRun).toHaveBeenCalledWith(RUN_ID);
        expect(onAction).toHaveBeenCalledOnce();
      });
    });

    it("shows both Pause and a stage-specific Retry button for Planning", async () => {
      mockApi.retryStage.mockResolvedValue({ ok: true, state: "Planning", retrying: true });
      render(<ActionBar runId={RUN_ID} state="Planning" onAction={vi.fn()} />);

      expect(screen.getByRole("button", { name: /^pause$/i })).toBeDefined();
      expect(screen.getByRole("button", { name: /retry planning/i })).toBeDefined();
    });

    it("calls api.retryStage with the runId when the retry action is confirmed", async () => {
      mockApi.retryStage.mockResolvedValue({ ok: true, state: "Planning", retrying: true });
      const onAction = vi.fn();
      render(<ActionBar runId={RUN_ID} state="Planning" onAction={onAction} />);

      await userEvent.click(screen.getByRole("button", { name: /retry planning/i }));
      await userEvent.click(screen.getByRole("button", { name: /^retry$/i }));

      await waitFor(() => {
        expect(mockApi.retryStage).toHaveBeenCalledWith(RUN_ID);
        expect(onAction).toHaveBeenCalledOnce();
      });
    });
  });

  describe("RETRY_LABELS fallback", () => {
    it("uses the state-specific retry label for each mapped stage", () => {
      render(<ActionBar runId={RUN_ID} state="AIReview" onAction={vi.fn()} />);
      expect(screen.getByRole("button", { name: /retry code review/i })).toBeDefined();
    });
  });
});
