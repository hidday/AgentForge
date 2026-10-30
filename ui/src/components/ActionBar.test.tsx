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
const RUN_ID = "run-1";

describe("ActionBar", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    for (const key of Object.keys(mockApi)) {
      mockApi[key].mockResolvedValue({ ok: true });
    }
  });

  it("renders nothing when state has no applicable actions", () => {
    const onAction = vi.fn();
    const { container } = render(<ActionBar runId={RUN_ID} state="Done" onAction={onAction} />);
    expect(container.firstChild).toBeNull();
  });

  describe("AwaitingPlanApproval state", () => {
    it("shows Approve Plan, Reject Plan, Re-review Plan, and Revise Plan, but not Answer Questions or Answer Optional Questions by default", () => {
      render(<ActionBar runId={RUN_ID} state="AwaitingPlanApproval" onAction={vi.fn()} />);
      expect(screen.getByRole("button", { name: /approve plan/i })).toBeDefined();
      expect(screen.getByRole("button", { name: /reject plan/i })).toBeDefined();
      expect(screen.getByRole("button", { name: /re-review plan/i })).toBeDefined();
      expect(screen.getByRole("button", { name: /revise plan/i })).toBeDefined();
      expect(screen.queryByRole("button", { name: /^answer questions$/i })).toBeNull();
      expect(screen.queryByRole("button", { name: /answer optional questions/i })).toBeNull();
    });

    it("shows Answer Optional Questions button when hasOptionalQuestions is true", () => {
      const onScrollToQuestions = vi.fn();
      render(
        <ActionBar
          runId={RUN_ID}
          state="AwaitingPlanApproval"
          onAction={vi.fn()}
          onScrollToQuestions={onScrollToQuestions}
          hasOptionalQuestions
        />,
      );
      const btn = screen.getByRole("button", { name: /answer optional questions/i });
      expect(btn).toBeDefined();
    });

    it("clicking Approve Plan opens confirm dialog; confirming calls api.approvePlan and onAction", async () => {
      const onAction = vi.fn();
      mockApi.approvePlan.mockResolvedValue({ ok: true, state: "Implementing" });
      render(<ActionBar runId={RUN_ID} state="AwaitingPlanApproval" onAction={onAction} />);

      await userEvent.click(screen.getByRole("button", { name: /approve plan/i }));
      expect(screen.getByRole("heading", { name: "Approve Plan" })).toBeDefined();
      expect(screen.getByText(/begin coding/i)).toBeDefined();

      const textarea = screen.getByPlaceholderText(/extra context/i);
      await userEvent.type(textarea, "watch out for X");

      await userEvent.click(screen.getByRole("button", { name: /approve & start/i }));

      await waitFor(() => {
        expect(mockApi.approvePlan).toHaveBeenCalledWith(RUN_ID, "watch out for X");
      });
      expect(onAction).toHaveBeenCalledTimes(1);
      // Dialog should be closed afterwards
      await waitFor(() => {
        expect(screen.queryByRole("button", { name: /approve & start/i })).toBeNull();
      });
    });

    it("cancelling the confirm dialog does not call the API", async () => {
      render(<ActionBar runId={RUN_ID} state="AwaitingPlanApproval" onAction={vi.fn()} />);
      await userEvent.click(screen.getByRole("button", { name: /approve plan/i }));
      await userEvent.click(screen.getByRole("button", { name: /^cancel$/i }));
      expect(mockApi.approvePlan).not.toHaveBeenCalled();
      expect(screen.queryByRole("button", { name: /approve & start/i })).toBeNull();
    });

    it("swallows API errors from the confirm dialog action and still closes the dialog", async () => {
      const onAction = vi.fn();
      mockApi.approvePlan.mockRejectedValue(new Error("boom"));
      render(<ActionBar runId={RUN_ID} state="AwaitingPlanApproval" onAction={onAction} />);
      await userEvent.click(screen.getByRole("button", { name: /approve plan/i }));
      await userEvent.click(screen.getByRole("button", { name: /approve & start/i }));

      await waitFor(() => {
        expect(mockApi.approvePlan).toHaveBeenCalled();
      });
      // onAction is only called on success
      expect(onAction).not.toHaveBeenCalled();
      await waitFor(() => {
        expect(screen.queryByRole("button", { name: /approve & start/i })).toBeNull();
      });
    });

    it("clicking Re-review Plan opens its dialog and confirming calls api.reReviewPlan", async () => {
      render(<ActionBar runId={RUN_ID} state="AwaitingPlanApproval" onAction={vi.fn()} />);
      await userEvent.click(screen.getByRole("button", { name: /re-review plan/i }));
      expect(screen.getByRole("heading", { name: "Re-review Plan" })).toBeDefined();
      await userEvent.click(screen.getByRole("button", { name: /^re-review$/i }));
      await waitFor(() => {
        expect(mockApi.reReviewPlan).toHaveBeenCalledWith(RUN_ID, undefined);
      });
    });

    it("clicking Revise Plan opens its dialog and confirming calls api.revisePlan", async () => {
      render(<ActionBar runId={RUN_ID} state="AwaitingPlanApproval" onAction={vi.fn()} />);
      await userEvent.click(screen.getByRole("button", { name: /revise plan/i }));
      expect(screen.getByRole("heading", { name: "Revise Plan" })).toBeDefined();
      await userEvent.click(screen.getByRole("button", { name: /^revise$/i }));
      await waitFor(() => {
        expect(mockApi.revisePlan).toHaveBeenCalledWith(RUN_ID, undefined);
      });
    });

    it("clicking Reject Plan opens the custom reject dialog with 'iterate' mode selected by default", async () => {
      render(<ActionBar runId={RUN_ID} state="AwaitingPlanApproval" onAction={vi.fn()} />);
      await userEvent.click(screen.getByRole("button", { name: /^reject plan$/i }));
      expect(screen.getByText(/send it back for re-planning/i)).toBeDefined();
      expect(screen.getByText("Revise plan")).toBeDefined();
      expect(screen.getByText("Start fresh")).toBeDefined();
    });

    it("reject dialog: switching to 'fresh' mode and confirming calls api.rejectPlan with mode=fresh and trimmed context", async () => {
      const onAction = vi.fn();
      render(<ActionBar runId={RUN_ID} state="AwaitingPlanApproval" onAction={onAction} />);
      await userEvent.click(screen.getByRole("button", { name: /^reject plan$/i }));

      await userEvent.click(screen.getByText("Start fresh"));

      const textarea = screen.getByPlaceholderText(/describe what should change/i);
      await userEvent.type(textarea, "  please simplify  ");

      // There are now two "Reject Plan" labelled controls: the dialog's confirm button.
      const confirmButtons = screen.getAllByRole("button", { name: /^reject plan$/i });
      await userEvent.click(confirmButtons[confirmButtons.length - 1]);

      await waitFor(() => {
        expect(mockApi.rejectPlan).toHaveBeenCalledWith(RUN_ID, "please simplify", "fresh");
      });
      expect(onAction).toHaveBeenCalledTimes(1);
    });

    it("reject dialog: empty feedback is sent as undefined context with default 'iterate' mode", async () => {
      render(<ActionBar runId={RUN_ID} state="AwaitingPlanApproval" onAction={vi.fn()} />);
      await userEvent.click(screen.getByRole("button", { name: /^reject plan$/i }));
      const confirmButtons = screen.getAllByRole("button", { name: /^reject plan$/i });
      await userEvent.click(confirmButtons[confirmButtons.length - 1]);

      await waitFor(() => {
        expect(mockApi.rejectPlan).toHaveBeenCalledWith(RUN_ID, undefined, "iterate");
      });
    });

    it("reject dialog: clicking Cancel closes it without calling the API and resets state", async () => {
      render(<ActionBar runId={RUN_ID} state="AwaitingPlanApproval" onAction={vi.fn()} />);
      await userEvent.click(screen.getByRole("button", { name: /^reject plan$/i }));
      const textarea = screen.getByPlaceholderText(/describe what should change/i);
      await userEvent.type(textarea, "some feedback");

      const cancelButtons = screen.getAllByRole("button", { name: /^cancel$/i });
      await userEvent.click(cancelButtons[cancelButtons.length - 1]);

      expect(mockApi.rejectPlan).not.toHaveBeenCalled();
      expect(screen.queryByPlaceholderText(/describe what should change/i)).toBeNull();

      // Reopening should show the textarea cleared again
      await userEvent.click(screen.getByRole("button", { name: /^reject plan$/i }));
      expect(
        (screen.getByPlaceholderText(/describe what should change/i) as HTMLTextAreaElement)
          .value,
      ).toBe("");
    });

    it("reject dialog: clicking the backdrop cancels the dialog", async () => {
      const { container } = render(
        <ActionBar runId={RUN_ID} state="AwaitingPlanApproval" onAction={vi.fn()} />,
      );
      await userEvent.click(screen.getByRole("button", { name: /^reject plan$/i }));
      const backdrop = container.querySelector(".fixed.inset-0 .absolute.inset-0");
      expect(backdrop).not.toBeNull();
      await userEvent.click(backdrop as Element);
      expect(screen.queryByPlaceholderText(/describe what should change/i)).toBeNull();
    });

    it("reject dialog: buttons are disabled and show 'Working...' while the request is pending", async () => {
      let resolveRequest!: (v: unknown) => void;
      mockApi.rejectPlan.mockReturnValue(
        new Promise((res) => {
          resolveRequest = res;
        }),
      );
      render(<ActionBar runId={RUN_ID} state="AwaitingPlanApproval" onAction={vi.fn()} />);
      await userEvent.click(screen.getByRole("button", { name: /^reject plan$/i }));
      const confirmButtons = screen.getAllByRole("button", { name: /^reject plan$/i });
      await userEvent.click(confirmButtons[confirmButtons.length - 1]);

      expect(screen.getByText(/working\.\.\./i)).toBeDefined();
      const cancelBtn = screen.getAllByRole("button", { name: /^cancel$/i });
      expect((cancelBtn[cancelBtn.length - 1] as HTMLButtonElement).disabled).toBe(true);

      resolveRequest({ ok: true });
      await waitFor(() => {
        expect(screen.queryByText(/working\.\.\./i)).toBeNull();
      });
    });

    it("swallows rejectPlan API errors and still closes the dialog", async () => {
      mockApi.rejectPlan.mockRejectedValue(new Error("server down"));
      render(<ActionBar runId={RUN_ID} state="AwaitingPlanApproval" onAction={vi.fn()} />);
      await userEvent.click(screen.getByRole("button", { name: /^reject plan$/i }));
      const confirmButtons = screen.getAllByRole("button", { name: /^reject plan$/i });
      await userEvent.click(confirmButtons[confirmButtons.length - 1]);

      await waitFor(() => {
        expect(mockApi.rejectPlan).toHaveBeenCalled();
      });
      await waitFor(() => {
        expect(screen.queryByPlaceholderText(/describe what should change/i)).toBeNull();
      });
    });
  });

  it("ReadyForHumanReview state shows only Approve & Complete, and confirming calls api.approveReview", async () => {
    const onAction = vi.fn();
    render(<ActionBar runId={RUN_ID} state="ReadyForHumanReview" onAction={onAction} />);
    expect(screen.queryByRole("button", { name: /approve plan/i })).toBeNull();
    const btn = screen.getByRole("button", { name: /approve & complete/i });
    await userEvent.click(btn);
    await userEvent.click(screen.getByRole("button", { name: /complete run/i }));
    await waitFor(() => {
      expect(mockApi.approveReview).toHaveBeenCalledWith(RUN_ID);
    });
    expect(onAction).toHaveBeenCalledTimes(1);
  });

  it("an active-category state (Planning) shows both Pause and the stage-specific Retry button", async () => {
    render(<ActionBar runId={RUN_ID} state="Planning" onAction={vi.fn()} />);
    expect(screen.getByRole("button", { name: /^pause$/i })).toBeDefined();
    const retryBtn = screen.getByRole("button", { name: /retry planning/i });
    expect(retryBtn).toBeDefined();
  });

  it("clicking Pause opens the Pause dialog and confirming calls api.pauseRun", async () => {
    const onAction = vi.fn();
    render(<ActionBar runId={RUN_ID} state="Planning" onAction={onAction} />);
    await userEvent.click(screen.getByRole("button", { name: /^pause$/i }));
    expect(screen.getByRole("heading", { name: "Pause Run" })).toBeDefined();
    const pauseButtons = screen.getAllByRole("button", { name: /^pause$/i });
    await userEvent.click(pauseButtons[pauseButtons.length - 1]);
    await waitFor(() => {
      expect(mockApi.pauseRun).toHaveBeenCalledWith(RUN_ID);
    });
    expect(onAction).toHaveBeenCalledTimes(1);
  });

  it.each(["AIBlocked", "HumanClarificationNeeded", "Failed"])(
    "%s state shows the Resume button; confirming calls api.resumeRun",
    async (state) => {
      const onAction = vi.fn();
      render(<ActionBar runId={RUN_ID} state={state} onAction={onAction} />);
      const resumeBtn = screen.getByRole("button", { name: /^resume$/i });
      await userEvent.click(resumeBtn);
      expect(screen.getByRole("heading", { name: "Resume Run" })).toBeDefined();
      const resumeButtons = screen.getAllByRole("button", { name: /^resume$/i });
      await userEvent.click(resumeButtons[resumeButtons.length - 1]);
      await waitFor(() => {
        expect(mockApi.resumeRun).toHaveBeenCalledWith(RUN_ID);
      });
      expect(onAction).toHaveBeenCalledTimes(1);
    },
  );

  it("HumanClarificationNeeded shows Answer Questions button which triggers onScrollToQuestions", async () => {
    const onScrollToQuestions = vi.fn();
    render(
      <ActionBar
        runId={RUN_ID}
        state="HumanClarificationNeeded"
        onAction={vi.fn()}
        onScrollToQuestions={onScrollToQuestions}
      />,
    );
    const btn = screen.getByRole("button", { name: /^answer questions$/i });
    await userEvent.click(btn);
    expect(onScrollToQuestions).toHaveBeenCalledTimes(1);
  });

  it.each([
    ["Todo", "Start Run"],
    ["Planning", "Retry Planning"],
    ["PlanRevision", "Retry Plan Revision"],
    ["PlanReview", "Retry Plan Review"],
    ["Implementing", "Retry Execution"],
    ["AIReview", "Retry Code Review"],
    ["AddressingReview", "Retry Remediation"],
  ])("state %s shows retry button labelled %s; confirming calls api.retryStage", async (state, label) => {
    const onAction = vi.fn();
    render(<ActionBar runId={RUN_ID} state={state} onAction={onAction} />);
    const retryBtn = screen.getByRole("button", { name: new RegExp(`^${label}$`, "i") });
    await userEvent.click(retryBtn);
    const confirmBtn = screen.getByRole("button", { name: /^retry$/i });
    await userEvent.click(confirmBtn);
    await waitFor(() => {
      expect(mockApi.retryStage).toHaveBeenCalledWith(RUN_ID);
    });
    expect(onAction).toHaveBeenCalledTimes(1);
  });
});
