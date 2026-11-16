import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
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

const mockApi = api as unknown as {
  approvePlan: ReturnType<typeof vi.fn>;
  rejectPlan: ReturnType<typeof vi.fn>;
  approveReview: ReturnType<typeof vi.fn>;
  pauseRun: ReturnType<typeof vi.fn>;
  resumeRun: ReturnType<typeof vi.fn>;
  retryStage: ReturnType<typeof vi.fn>;
  reReviewPlan: ReturnType<typeof vi.fn>;
  revisePlan: ReturnType<typeof vi.fn>;
};

const RUN_ID = "run-1";

describe("ActionBar", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("renders nothing for a state with no available actions", () => {
    const { container } = render(
      <ActionBar runId={RUN_ID} state="Planning" onAction={vi.fn()} />,
    );
    expect(container.firstChild).toBeNull();
  });

  describe("AwaitingPlanApproval state", () => {
    it("shows Approve Plan, Reject Plan, Re-review Plan, and Revise Plan buttons", () => {
      render(
        <ActionBar runId={RUN_ID} state="AwaitingPlanApproval" onAction={vi.fn()} />,
      );
      expect(screen.getByRole("button", { name: /approve plan/i })).toBeDefined();
      expect(screen.getByRole("button", { name: /reject plan/i })).toBeDefined();
      expect(screen.getByRole("button", { name: /re-review plan/i })).toBeDefined();
      expect(screen.getByRole("button", { name: /revise plan/i })).toBeDefined();
    });

    it("also shows the Answer Optional Questions button when hasOptionalQuestions is true", () => {
      render(
        <ActionBar
          runId={RUN_ID}
          state="AwaitingPlanApproval"
          onAction={vi.fn()}
          hasOptionalQuestions
          onScrollToQuestions={vi.fn()}
        />,
      );
      expect(
        screen.getByRole("button", { name: /answer optional questions/i }),
      ).toBeDefined();
    });

    it("calls onScrollToQuestions when Answer Optional Questions is clicked", async () => {
      const onScrollToQuestions = vi.fn();
      render(
        <ActionBar
          runId={RUN_ID}
          state="AwaitingPlanApproval"
          onAction={vi.fn()}
          hasOptionalQuestions
          onScrollToQuestions={onScrollToQuestions}
        />,
      );
      await userEvent.click(
        screen.getByRole("button", { name: /answer optional questions/i }),
      );
      expect(onScrollToQuestions).toHaveBeenCalledOnce();
    });

    it("opens a confirm dialog and calls api.approvePlan with the entered note on Approve & Start", async () => {
      mockApi.approvePlan.mockResolvedValue({});
      const onAction = vi.fn();
      render(
        <ActionBar runId={RUN_ID} state="AwaitingPlanApproval" onAction={onAction} />,
      );

      await userEvent.click(screen.getByRole("button", { name: /approve plan/i }));

      expect(screen.getByText("Approve Plan")).toBeDefined();
      expect(
        screen.getByText(/This will approve the current plan/i),
      ).toBeDefined();

      const textarea = screen.getByPlaceholderText(/extra context/i);
      await userEvent.type(textarea, "Watch the rollout");

      await userEvent.click(screen.getByRole("button", { name: /approve & start/i }));

      await waitFor(() => {
        expect(mockApi.approvePlan).toHaveBeenCalledWith(
          RUN_ID,
          "Watch the rollout",
        );
        expect(onAction).toHaveBeenCalledOnce();
      });
    });

    it("opens the custom reject dialog and calls api.rejectPlan with feedback and mode", async () => {
      mockApi.rejectPlan.mockResolvedValue({});
      const onAction = vi.fn();
      render(
        <ActionBar runId={RUN_ID} state="AwaitingPlanApproval" onAction={onAction} />,
      );

      await userEvent.click(screen.getByRole("button", { name: /reject plan/i }));

      expect(
        screen.getByText(/This will reject the current plan/i),
      ).toBeDefined();

      // default mode is "iterate"; switch to "fresh"
      await userEvent.click(screen.getByText("Start fresh"));

      const textarea = screen.getByPlaceholderText(/describe what should change/i);
      await userEvent.type(textarea, "Needs a different approach");

      // There are two "Reject Plan" labelled buttons now (the opener + dialog confirm);
      // find the one inside the dialog (last one rendered).
      const rejectButtons = screen.getAllByRole("button", { name: /reject plan/i });
      await userEvent.click(rejectButtons[rejectButtons.length - 1]);

      await waitFor(() => {
        expect(mockApi.rejectPlan).toHaveBeenCalledWith(
          RUN_ID,
          "Needs a different approach",
          "fresh",
        );
        expect(onAction).toHaveBeenCalledOnce();
      });
    });

    it("cancels the reject dialog without calling the API", async () => {
      render(
        <ActionBar runId={RUN_ID} state="AwaitingPlanApproval" onAction={vi.fn()} />,
      );
      await userEvent.click(screen.getByRole("button", { name: /reject plan/i }));
      expect(
        screen.getByText(/This will reject the current plan/i),
      ).toBeDefined();

      await userEvent.click(screen.getByRole("button", { name: /cancel/i }));

      expect(
        screen.queryByText(/This will reject the current plan/i),
      ).toBeNull();
      expect(mockApi.rejectPlan).not.toHaveBeenCalled();
    });

    it("calls api.reReviewPlan with the note when Re-review is confirmed", async () => {
      mockApi.reReviewPlan.mockResolvedValue({});
      render(
        <ActionBar runId={RUN_ID} state="AwaitingPlanApproval" onAction={vi.fn()} />,
      );

      await userEvent.click(screen.getByRole("button", { name: /re-review plan/i }));
      expect(screen.getByText(/Run the plan reviewer again/i)).toBeDefined();

      await userEvent.click(screen.getByRole("button", { name: /^re-review$/i }));

      await waitFor(() => {
        expect(mockApi.reReviewPlan).toHaveBeenCalledWith(RUN_ID, undefined);
      });
    });

    it("calls api.revisePlan with the note when Revise is confirmed", async () => {
      mockApi.revisePlan.mockResolvedValue({});
      render(
        <ActionBar runId={RUN_ID} state="AwaitingPlanApproval" onAction={vi.fn()} />,
      );

      await userEvent.click(screen.getByRole("button", { name: /revise plan/i }));
      const textarea = screen.getByPlaceholderText(/tighten the rollout/i);
      await userEvent.type(textarea, "Expand the test plan");

      await userEvent.click(screen.getByRole("button", { name: /^revise$/i }));

      await waitFor(() => {
        expect(mockApi.revisePlan).toHaveBeenCalledWith(
          RUN_ID,
          "Expand the test plan",
        );
      });
    });
  });

  describe("ReadyForHumanReview state", () => {
    it("shows the Approve & Complete button and calls api.approveReview on confirm", async () => {
      mockApi.approveReview.mockResolvedValue({});
      const onAction = vi.fn();
      render(
        <ActionBar runId={RUN_ID} state="ReadyForHumanReview" onAction={onAction} />,
      );

      await userEvent.click(
        screen.getByRole("button", { name: /approve & complete/i }),
      );
      expect(screen.getByText(/mark the run as complete/i)).toBeDefined();

      await userEvent.click(screen.getByRole("button", { name: /complete run/i }));

      await waitFor(() => {
        expect(mockApi.approveReview).toHaveBeenCalledWith(RUN_ID);
        expect(onAction).toHaveBeenCalledOnce();
      });
    });
  });

  describe("active category states (Pause action)", () => {
    it("shows the Pause button for an active state like Implementing and calls api.pauseRun", async () => {
      mockApi.pauseRun.mockResolvedValue({});
      const onAction = vi.fn();
      render(<ActionBar runId={RUN_ID} state="Implementing" onAction={onAction} />);

      await userEvent.click(screen.getByRole("button", { name: /pause/i }));
      expect(screen.getByText(/This will pause the run/i)).toBeDefined();

      const pauseButtons = screen.getAllByRole("button", { name: /^pause$/i });
      await userEvent.click(pauseButtons[pauseButtons.length - 1]);

      await waitFor(() => {
        expect(mockApi.pauseRun).toHaveBeenCalledWith(RUN_ID);
        expect(onAction).toHaveBeenCalledOnce();
      });
    });
  });

  describe("Resume action", () => {
    it.each(["AIBlocked", "HumanClarificationNeeded", "Failed"])(
      "shows the Resume button for state %s and calls api.resumeRun",
      async (state) => {
        mockApi.resumeRun.mockResolvedValue({});
        const onAction = vi.fn();
        render(<ActionBar runId={RUN_ID} state={state} onAction={onAction} />);

        await userEvent.click(screen.getByRole("button", { name: /resume/i }));
        expect(screen.getByText(/reset the run back to the start/i)).toBeDefined();

        const resumeButtons = screen.getAllByRole("button", { name: /^resume$/i });
        await userEvent.click(resumeButtons[resumeButtons.length - 1]);

        await waitFor(() => {
          expect(mockApi.resumeRun).toHaveBeenCalledWith(RUN_ID);
          expect(onAction).toHaveBeenCalledOnce();
        });
      },
    );

    it("shows the Answer Questions button for HumanClarificationNeeded and calls onScrollToQuestions", async () => {
      const onScrollToQuestions = vi.fn();
      render(
        <ActionBar
          runId={RUN_ID}
          state="HumanClarificationNeeded"
          onAction={vi.fn()}
          onScrollToQuestions={onScrollToQuestions}
        />,
      );
      await userEvent.click(
        screen.getByRole("button", { name: /answer questions/i }),
      );
      expect(onScrollToQuestions).toHaveBeenCalledOnce();
    });
  });

  describe("Retry actions keyed by RETRY_LABELS", () => {
    it.each([
      ["Todo", "Start Run"],
      ["Planning", "Retry Planning"],
      ["PlanRevision", "Retry Plan Revision"],
      ["PlanReview", "Retry Plan Review"],
      ["Implementing", "Retry Execution"],
      ["AIReview", "Retry Code Review"],
      ["AddressingReview", "Retry Remediation"],
    ])("shows label %2$s for state %1$s and calls api.retryStage on confirm", async (state, label) => {
      mockApi.retryStage.mockResolvedValue({});
      const onAction = vi.fn();
      render(<ActionBar runId={RUN_ID} state={state} onAction={onAction} />);

      const retryBtn = screen.getByRole("button", { name: label });
      await userEvent.click(retryBtn);

      expect(
        screen.getByText(new RegExp(`Re-run the current stage \\(${state}\\)`, "i")),
      ).toBeDefined();

      await userEvent.click(screen.getByRole("button", { name: /^retry$/i }));

      await waitFor(() => {
        expect(mockApi.retryStage).toHaveBeenCalledWith(RUN_ID);
        expect(onAction).toHaveBeenCalledOnce();
      });
    });
  });

  it("shows a loading state (disabled Cancel/Confirm) while the action is in flight", async () => {
    let resolveAction!: () => void;
    mockApi.pauseRun.mockReturnValue(
      new Promise<void>((resolve) => {
        resolveAction = resolve;
      }),
    );
    render(<ActionBar runId={RUN_ID} state="Implementing" onAction={vi.fn()} />);

    await userEvent.click(screen.getByRole("button", { name: /pause/i }));
    const pauseButtons1 = screen.getAllByRole("button", { name: /^pause$/i });
    await userEvent.click(pauseButtons1[pauseButtons1.length - 1]);

    // While loading: the confirm button shows "Working..." and Cancel is disabled
    expect(screen.getByText("Working...")).toBeDefined();
    const cancelBtn = screen.getByRole("button", { name: /cancel/i });
    expect((cancelBtn as HTMLButtonElement).disabled).toBe(true);

    resolveAction();
    await waitFor(() => {
      expect(screen.queryByText("Working...")).toBeNull();
    });
  });

  it("closes the dialog without calling onAction when the API call rejects", async () => {
    mockApi.pauseRun.mockRejectedValue(new Error("server exploded"));
    const onAction = vi.fn();
    render(<ActionBar runId={RUN_ID} state="Implementing" onAction={onAction} />);

    await userEvent.click(screen.getByRole("button", { name: /pause/i }));
    await userEvent.click(screen.getByRole("button", { name: /^pause$/i }));

    await waitFor(() => {
      expect(screen.queryByText(/This will pause the run/i)).toBeNull();
    });
    expect(onAction).not.toHaveBeenCalled();
  });

  it("cancels a generic confirm dialog without invoking the API", async () => {
    render(<ActionBar runId={RUN_ID} state="Implementing" onAction={vi.fn()} />);

    await userEvent.click(screen.getByRole("button", { name: /pause/i }));
    await userEvent.click(screen.getByRole("button", { name: /cancel/i }));

    expect(screen.queryByText(/This will pause the run/i)).toBeNull();
    expect(mockApi.pauseRun).not.toHaveBeenCalled();
  });

  it("re-enables the reject dialog's buttons and resets fields after a failed rejection", async () => {
    mockApi.rejectPlan.mockRejectedValue(new Error("Linear sync failed"));
    render(
      <ActionBar runId={RUN_ID} state="AwaitingPlanApproval" onAction={vi.fn()} />,
    );

    await userEvent.click(screen.getByRole("button", { name: /reject plan/i }));
    const textarea = screen.getByPlaceholderText(/describe what should change/i);
    await userEvent.type(textarea, "feedback text");

    const rejectButtons = screen.getAllByRole("button", { name: /reject plan/i });
    await userEvent.click(rejectButtons[rejectButtons.length - 1]);

    await waitFor(() => {
      expect(mockApi.rejectPlan).toHaveBeenCalled();
      // Dialog closes even on failure (handled by client)
      expect(
        screen.queryByText(/This will reject the current plan/i),
      ).toBeNull();
    });
  });
});
