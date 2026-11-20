import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
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
    mockApi.approvePlan.mockResolvedValue({ ok: true, state: "Implementing" });
    mockApi.rejectPlan.mockResolvedValue({ ok: true, state: "Planning" });
    mockApi.reReviewPlan.mockResolvedValue({ ok: true, runId: RUN_ID });
    mockApi.revisePlan.mockResolvedValue({ ok: true, runId: RUN_ID });
    mockApi.approveReview.mockResolvedValue({ ok: true, state: "Done" });
    mockApi.pauseRun.mockResolvedValue({ ok: true });
    mockApi.resumeRun.mockResolvedValue({ ok: true });
    mockApi.retryStage.mockResolvedValue({ ok: true, state: "Todo", retrying: true });
  });

  it("renders nothing when state has no applicable actions", () => {
    const { container } = render(
      <ActionBar runId={RUN_ID} state="Done" onAction={vi.fn()} />,
    );
    expect(container.firstChild).toBeNull();
  });

  it("shows a Start Run retry button for Todo state and calls api.retryStage on confirm", async () => {
    const onAction = vi.fn();
    render(<ActionBar runId={RUN_ID} state="Todo" onAction={onAction} />);

    const startBtn = screen.getByRole("button", { name: /start run/i });
    await userEvent.click(startBtn);

    // Confirmation dialog shown with the retry-specific copy.
    expect(screen.getByRole("heading", { name: "Start Run" })).toBeDefined();
    expect(screen.getByText(/Re-run the current stage \(Todo\)/i)).toBeDefined();

    await userEvent.click(screen.getByRole("button", { name: "Retry" }));

    await waitFor(() => {
      expect(mockApi.retryStage).toHaveBeenCalledWith(RUN_ID);
      expect(onAction).toHaveBeenCalledOnce();
    });

    // Dialog closes after confirming.
    expect(screen.queryByText(/Re-run the current stage/i)).toBeNull();
  });

  it("closes the confirm dialog without calling the action when Cancel is clicked", async () => {
    const onAction = vi.fn();
    render(<ActionBar runId={RUN_ID} state="Todo" onAction={onAction} />);

    await userEvent.click(screen.getByRole("button", { name: /start run/i }));
    expect(screen.getByRole("heading", { name: "Start Run" })).toBeDefined();

    await userEvent.click(screen.getByRole("button", { name: "Cancel" }));

    expect(screen.queryByRole("heading", { name: "Start Run" })).toBeNull();
    expect(mockApi.retryStage).not.toHaveBeenCalled();
    expect(onAction).not.toHaveBeenCalled();
  });

  it("shows a stage-specific retry label, e.g. 'Retry Execution' for Implementing", () => {
    render(<ActionBar runId={RUN_ID} state="Implementing" onAction={vi.fn()} />);
    expect(screen.getByRole("button", { name: /retry execution/i })).toBeDefined();
  });

  it("falls back to generic Pause button styling when category is active (e.g. Planning)", async () => {
    const onAction = vi.fn();
    render(<ActionBar runId={RUN_ID} state="Planning" onAction={onAction} />);

    // Planning is both "active" (shows Pause) and has a retry label (Retry Planning).
    const pauseBtn = screen.getByRole("button", { name: "Pause" });
    await userEvent.click(pauseBtn);
    const dialogHeading = screen.getByRole("heading", { name: "Pause Run" });
    const dialogPanel = dialogHeading.closest("div") as HTMLElement;
    await userEvent.click(within(dialogPanel).getByRole("button", { name: "Pause" }));

    await waitFor(() => {
      expect(mockApi.pauseRun).toHaveBeenCalledWith(RUN_ID);
      expect(onAction).toHaveBeenCalledOnce();
    });
  });

  it("shows Resume button for AIBlocked, HumanClarificationNeeded, and Failed states", () => {
    for (const state of ["AIBlocked", "HumanClarificationNeeded", "Failed"]) {
      const { unmount } = render(
        <ActionBar runId={RUN_ID} state={state} onAction={vi.fn()} />,
      );
      expect(screen.getByRole("button", { name: /resume/i })).toBeDefined();
      unmount();
    }
  });

  it("calls api.resumeRun when Resume is confirmed", async () => {
    const onAction = vi.fn();
    render(<ActionBar runId={RUN_ID} state="AIBlocked" onAction={onAction} />);

    await userEvent.click(screen.getByRole("button", { name: /resume/i }));
    const dialogHeading = screen.getByRole("heading", { name: "Resume Run" });
    const dialogPanel = dialogHeading.closest("div") as HTMLElement;
    await userEvent.click(within(dialogPanel).getByRole("button", { name: "Resume" }));

    await waitFor(() => {
      expect(mockApi.resumeRun).toHaveBeenCalledWith(RUN_ID);
      expect(onAction).toHaveBeenCalledOnce();
    });
  });

  it("shows Answer Questions button for HumanClarificationNeeded and calls onScrollToQuestions", async () => {
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

  it("shows Approve & Complete for ReadyForHumanReview and calls api.approveReview with no note", async () => {
    const onAction = vi.fn();
    render(
      <ActionBar runId={RUN_ID} state="ReadyForHumanReview" onAction={onAction} />,
    );

    await userEvent.click(screen.getByRole("button", { name: /approve & complete/i }));
    // No notes field for this action.
    expect(screen.queryByRole("textbox")).toBeNull();

    await userEvent.click(screen.getByRole("button", { name: "Complete Run" }));

    await waitFor(() => {
      expect(mockApi.approveReview).toHaveBeenCalledWith(RUN_ID);
      expect(onAction).toHaveBeenCalledOnce();
    });
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

    it("shows Answer Optional Questions button only when hasOptionalQuestions is true", () => {
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
      await userEvent.click(
        screen.getByRole("button", { name: /answer optional questions/i }),
      );
      expect(onScrollToQuestions).toHaveBeenCalledOnce();
    });

    it("approves the plan with a trimmed note via the confirm dialog", async () => {
      const onAction = vi.fn();
      render(
        <ActionBar runId={RUN_ID} state="AwaitingPlanApproval" onAction={onAction} />,
      );

      await userEvent.click(screen.getByRole("button", { name: /approve plan/i }));
      const textarea = screen.getByPlaceholderText(/extra context, edge cases/i);
      await userEvent.type(textarea, "  watch for flaky tests  ");
      await userEvent.click(screen.getByRole("button", { name: "Approve & Start" }));

      await waitFor(() => {
        expect(mockApi.approvePlan).toHaveBeenCalledWith(RUN_ID, "watch for flaky tests");
        expect(onAction).toHaveBeenCalledOnce();
      });
    });

    it("opens the Re-review Plan dialog and calls api.reReviewPlan", async () => {
      const onAction = vi.fn();
      render(
        <ActionBar runId={RUN_ID} state="AwaitingPlanApproval" onAction={onAction} />,
      );

      await userEvent.click(screen.getByRole("button", { name: /re-review plan/i }));
      expect(screen.getByText(/Run the plan reviewer again/i)).toBeDefined();
      await userEvent.click(screen.getByRole("button", { name: "Re-review" }));

      await waitFor(() => {
        expect(mockApi.reReviewPlan).toHaveBeenCalledWith(RUN_ID, undefined);
        expect(onAction).toHaveBeenCalledOnce();
      });
    });

    it("opens the Revise Plan dialog and calls api.revisePlan", async () => {
      const onAction = vi.fn();
      render(
        <ActionBar runId={RUN_ID} state="AwaitingPlanApproval" onAction={onAction} />,
      );

      await userEvent.click(screen.getByRole("button", { name: /revise plan/i }));
      expect(screen.getByText(/automatically run the plan reviser/i)).toBeDefined();
      await userEvent.click(screen.getByRole("button", { name: "Revise" }));

      await waitFor(() => {
        expect(mockApi.revisePlan).toHaveBeenCalledWith(RUN_ID, undefined);
        expect(onAction).toHaveBeenCalledOnce();
      });
    });

    it("opens a custom Reject Plan dialog with Revise/Start fresh mode toggle", async () => {
      render(
        <ActionBar runId={RUN_ID} state="AwaitingPlanApproval" onAction={vi.fn()} />,
      );

      await userEvent.click(screen.getByRole("button", { name: /reject plan/i }));

      expect(
        screen.getByText(/This will reject the current plan and send it back/i),
      ).toBeDefined();
      expect(screen.getByText("Revise plan")).toBeDefined();
      expect(screen.getByText("Start fresh")).toBeDefined();
    });

    it("defaults to iterate mode and submits rejectPlan with trimmed feedback", async () => {
      const onAction = vi.fn();
      render(
        <ActionBar runId={RUN_ID} state="AwaitingPlanApproval" onAction={onAction} />,
      );

      await userEvent.click(screen.getByRole("button", { name: /reject plan/i }));
      const textarea = screen.getByPlaceholderText(/describe what should change/i);
      await userEvent.type(textarea, "  tighten the rollback plan  ");

      // There are now two "Reject Plan" buttons (the opener, now obscured, and the
      // dialog's submit button) — the dialog submit button is the one inside the
      // dialog panel.
      const submitButtons = screen.getAllByRole("button", { name: /reject plan/i });
      const submitBtn = submitButtons[submitButtons.length - 1];
      await userEvent.click(submitBtn);

      await waitFor(() => {
        expect(mockApi.rejectPlan).toHaveBeenCalledWith(
          RUN_ID,
          "tighten the rollback plan",
          "iterate",
        );
        expect(onAction).toHaveBeenCalledOnce();
      });

      // Dialog closes after submission.
      expect(
        screen.queryByText(/This will reject the current plan and send it back/i),
      ).toBeNull();
    });

    it("submits rejectPlan with mode 'fresh' and undefined context when switched and left blank", async () => {
      const onAction = vi.fn();
      render(
        <ActionBar runId={RUN_ID} state="AwaitingPlanApproval" onAction={onAction} />,
      );

      await userEvent.click(screen.getByRole("button", { name: /reject plan/i }));
      await userEvent.click(screen.getByText("Start fresh"));
      // Switch back to "Revise plan" (iterate mode) before switching to fresh again,
      // to exercise both mode-toggle handlers.
      await userEvent.click(screen.getByText("Revise plan"));
      await userEvent.click(screen.getByText("Start fresh"));

      const submitButtons = screen.getAllByRole("button", { name: /reject plan/i });
      await userEvent.click(submitButtons[submitButtons.length - 1]);

      await waitFor(() => {
        expect(mockApi.rejectPlan).toHaveBeenCalledWith(RUN_ID, undefined, "fresh");
        expect(onAction).toHaveBeenCalledOnce();
      });
    });

    it("closes the Reject Plan dialog and clears state when Cancel is clicked", async () => {
      render(
        <ActionBar runId={RUN_ID} state="AwaitingPlanApproval" onAction={vi.fn()} />,
      );

      await userEvent.click(screen.getByRole("button", { name: /reject plan/i }));
      const textarea = screen.getByPlaceholderText(/describe what should change/i);
      await userEvent.type(textarea, "some feedback");
      await userEvent.click(screen.getByText("Start fresh"));

      await userEvent.click(screen.getByRole("button", { name: "Cancel" }));

      expect(
        screen.queryByText(/This will reject the current plan and send it back/i),
      ).toBeNull();
      expect(mockApi.rejectPlan).not.toHaveBeenCalled();

      // Reopening should show a reset dialog (blank feedback, iterate mode active again).
      await userEvent.click(screen.getByRole("button", { name: /reject plan/i }));
      expect(screen.getByPlaceholderText(/describe what should change/i)).toHaveProperty(
        "value",
        "",
      );
    });

    it("does not call onAction when an action rejects, but still closes the dialog", async () => {
      const onAction = vi.fn();
      mockApi.approvePlan.mockRejectedValue(new Error("Server error"));

      render(
        <ActionBar runId={RUN_ID} state="AwaitingPlanApproval" onAction={onAction} />,
      );

      await userEvent.click(screen.getByRole("button", { name: /approve plan/i }));
      await userEvent.click(screen.getByRole("button", { name: "Approve & Start" }));

      await waitFor(() => {
        expect(mockApi.approvePlan).toHaveBeenCalled();
      });
      await waitFor(() => {
        expect(screen.queryByText(/Approve & Start$/)).toBeNull();
      });

      expect(onAction).not.toHaveBeenCalled();
    });

    it("shows a loading state ('Working...') on the Reject Plan dialog while the request is pending", async () => {
      let resolveReject!: (v: { ok: boolean; state: string }) => void;
      mockApi.rejectPlan.mockReturnValue(
        new Promise((res) => {
          resolveReject = res;
        }),
      );

      render(
        <ActionBar runId={RUN_ID} state="AwaitingPlanApproval" onAction={vi.fn()} />,
      );

      await userEvent.click(screen.getByRole("button", { name: /reject plan/i }));
      const submitButtons = screen.getAllByRole("button", { name: /reject plan/i });
      await userEvent.click(submitButtons[submitButtons.length - 1]);

      expect(screen.getByText("Working...")).toBeDefined();

      resolveReject({ ok: true, state: "Planning" });

      await waitFor(() => {
        expect(screen.queryByText("Working...")).toBeNull();
      });
    });
  });
});
