import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
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

const RUN_ID = "run-42";

function resolvedApi() {
  for (const fn of Object.values(mockApi)) {
    fn.mockReset();
    fn.mockResolvedValue({ ok: true, state: "Whatever" });
  }
}

describe("ActionBar", () => {
  beforeEach(() => {
    resolvedApi();
  });

  it("renders nothing when no action applies to the current state", () => {
    const { container } = render(
      <ActionBar runId={RUN_ID} state="Done" onAction={vi.fn()} />,
    );
    expect(container.firstChild).toBeNull();
  });

  describe("Todo state", () => {
    it("shows a 'Start Run' retry button that calls api.retryStage on confirm", async () => {
      const onAction = vi.fn();
      render(<ActionBar runId={RUN_ID} state="Todo" onAction={onAction} />);

      const btn = screen.getByRole("button", { name: /Start Run/i });
      await userEvent.click(btn);

      expect(screen.getByRole("heading", { name: "Start Run" })).toBeDefined();
      expect(screen.getByText(/Re-run the current stage \(Todo\)/i)).toBeDefined();

      await userEvent.click(screen.getByRole("button", { name: "Retry" }));

      expect(mockApi.retryStage).toHaveBeenCalledWith(RUN_ID);
      expect(onAction).toHaveBeenCalledTimes(1);
    });
  });

  describe("AwaitingPlanApproval state", () => {
    it("shows Approve Plan, Reject Plan, Re-review Plan, and Revise Plan, but not Answer Optional Questions by default", () => {
      render(<ActionBar runId={RUN_ID} state="AwaitingPlanApproval" onAction={vi.fn()} />);
      expect(screen.getByRole("button", { name: /Approve Plan/i })).toBeDefined();
      expect(screen.getByRole("button", { name: /Reject Plan/i })).toBeDefined();
      expect(screen.getByRole("button", { name: /Re-review Plan/i })).toBeDefined();
      expect(screen.getByRole("button", { name: /Revise Plan/i })).toBeDefined();
      expect(screen.queryByRole("button", { name: /Answer Optional Questions/i })).toBeNull();
    });

    it("shows Answer Optional Questions when hasOptionalQuestions is true, and invokes onScrollToQuestions", async () => {
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
      const btn = screen.getByRole("button", { name: /Answer Optional Questions/i });
      await userEvent.click(btn);
      expect(onScrollToQuestions).toHaveBeenCalledTimes(1);
    });

    it("Approve Plan opens a confirm dialog with notes and calls api.approvePlan with the trimmed note", async () => {
      const onAction = vi.fn();
      render(<ActionBar runId={RUN_ID} state="AwaitingPlanApproval" onAction={onAction} />);

      await userEvent.click(screen.getByRole("button", { name: /^Approve Plan$/i }));

      expect(screen.getByRole("heading", { name: "Approve Plan" })).toBeDefined();
      const textarea = screen.getByPlaceholderText(/extra context, edge cases/i);
      await userEvent.type(textarea, "  watch the migration  ");

      await userEvent.click(screen.getByRole("button", { name: "Approve & Start" }));

      expect(mockApi.approvePlan).toHaveBeenCalledWith(RUN_ID, "watch the migration");
      expect(onAction).toHaveBeenCalledTimes(1);
    });

    it("Approve Plan dialog: clicking Cancel closes it without calling the API", async () => {
      const onAction = vi.fn();
      render(<ActionBar runId={RUN_ID} state="AwaitingPlanApproval" onAction={onAction} />);

      await userEvent.click(screen.getByRole("button", { name: /^Approve Plan$/i }));
      expect(screen.getByRole("heading", { name: "Approve Plan" })).toBeDefined();

      await userEvent.click(screen.getByRole("button", { name: "Cancel" }));

      expect(screen.queryByRole("heading", { name: "Approve Plan" })).toBeNull();
      expect(mockApi.approvePlan).not.toHaveBeenCalled();
      expect(onAction).not.toHaveBeenCalled();
    });

    it("Reject Plan opens the custom reject dialog defaulting to iterate mode, and submits feedback + mode", async () => {
      const onAction = vi.fn();
      render(<ActionBar runId={RUN_ID} state="AwaitingPlanApproval" onAction={onAction} />);

      await userEvent.click(screen.getByRole("button", { name: /^Reject Plan$/i }));

      expect(screen.getByText("This will reject the current plan and send it back for re-planning.")).toBeDefined();
      const iterateBtn = screen.getByRole("button", { name: /Revise plan Iterate with full context/i });
      expect(iterateBtn.className).toContain("bg-accent");

      const feedback = screen.getByPlaceholderText(/describe what should change/i);
      await userEvent.type(feedback, "Please simplify step 2");

      // Switch to "fresh" and back to "iterate" to exercise both mode-toggle handlers.
      await userEvent.click(screen.getByRole("button", { name: /Start fresh Clean slate, feedback only/i }));
      await userEvent.click(iterateBtn);
      expect(iterateBtn.className).toContain("bg-accent");

      const confirmButtons = screen.getAllByRole("button", { name: "Reject Plan" });
      // The second "Reject Plan" is the dialog's submit button (first is the trigger in the bar).
      await userEvent.click(confirmButtons[confirmButtons.length - 1]);

      expect(mockApi.rejectPlan).toHaveBeenCalledWith(RUN_ID, "Please simplify step 2", "iterate");
      expect(onAction).toHaveBeenCalledTimes(1);
    });

    it("Reject Plan can switch to 'Start fresh' mode and submits with no feedback as undefined", async () => {
      render(<ActionBar runId={RUN_ID} state="AwaitingPlanApproval" onAction={vi.fn()} />);
      await userEvent.click(screen.getByRole("button", { name: /^Reject Plan$/i }));

      await userEvent.click(screen.getByRole("button", { name: /Start fresh Clean slate, feedback only/i }));

      const confirmButtons = screen.getAllByRole("button", { name: "Reject Plan" });
      await userEvent.click(confirmButtons[confirmButtons.length - 1]);

      expect(mockApi.rejectPlan).toHaveBeenCalledWith(RUN_ID, undefined, "fresh");
    });

    it("Reject Plan cancel closes the dialog without calling the API", async () => {
      render(<ActionBar runId={RUN_ID} state="AwaitingPlanApproval" onAction={vi.fn()} />);
      await userEvent.click(screen.getByRole("button", { name: /^Reject Plan$/i }));

      const feedback = screen.getByPlaceholderText(/describe what should change/i);
      await userEvent.type(feedback, "abandoned feedback");

      await userEvent.click(screen.getByRole("button", { name: "Cancel" }));

      expect(mockApi.rejectPlan).not.toHaveBeenCalled();
      expect(screen.queryByPlaceholderText(/describe what should change/i)).toBeNull();
    });

    it("Re-review Plan opens its own confirm dialog and calls api.reReviewPlan", async () => {
      const onAction = vi.fn();
      render(<ActionBar runId={RUN_ID} state="AwaitingPlanApproval" onAction={onAction} />);

      await userEvent.click(screen.getByRole("button", { name: /^Re-review Plan$/i }));
      expect(screen.getAllByText("Re-review Plan").length).toBeGreaterThan(0);
      expect(screen.getByText(/Run the plan reviewer again/i)).toBeDefined();

      await userEvent.click(screen.getByRole("button", { name: "Re-review" }));

      expect(mockApi.reReviewPlan).toHaveBeenCalledWith(RUN_ID, undefined);
      expect(onAction).toHaveBeenCalledTimes(1);
    });

    it("Revise Plan opens its own confirm dialog and calls api.revisePlan with the note", async () => {
      const onAction = vi.fn();
      render(<ActionBar runId={RUN_ID} state="AwaitingPlanApproval" onAction={onAction} />);

      await userEvent.click(screen.getByRole("button", { name: /^Revise Plan$/i }));
      const textarea = screen.getByPlaceholderText(/tighten the rollout step/i);
      await userEvent.type(textarea, "expand tests");

      await userEvent.click(screen.getByRole("button", { name: "Revise" }));

      expect(mockApi.revisePlan).toHaveBeenCalledWith(RUN_ID, "expand tests");
      expect(onAction).toHaveBeenCalledTimes(1);
    });
  });

  describe("ReadyForHumanReview state", () => {
    it("shows Approve & Complete with no notes field, and calls api.approveReview on confirm", async () => {
      const onAction = vi.fn();
      render(<ActionBar runId={RUN_ID} state="ReadyForHumanReview" onAction={onAction} />);

      await userEvent.click(screen.getByRole("button", { name: /Approve & Complete/i }));
      expect(screen.getByText(/mark the run as complete/i)).toBeDefined();
      expect(screen.queryByRole("textbox")).toBeNull();

      await userEvent.click(screen.getByRole("button", { name: "Complete Run" }));

      expect(mockApi.approveReview).toHaveBeenCalledWith(RUN_ID);
      expect(onAction).toHaveBeenCalledTimes(1);
    });
  });

  describe("active category states", () => {
    it("Implementing state shows both Pause and Retry Execution buttons, each wired to the right API call", async () => {
      const onAction = vi.fn();
      render(<ActionBar runId={RUN_ID} state="Implementing" onAction={onAction} />);

      expect(screen.getByRole("button", { name: /Pause/i })).toBeDefined();
      expect(screen.getByRole("button", { name: /Retry Execution/i })).toBeDefined();

      await userEvent.click(screen.getByRole("button", { name: /Pause/i }));
      const pauseConfirmButtons = screen.getAllByRole("button", { name: "Pause" });
      await userEvent.click(pauseConfirmButtons[pauseConfirmButtons.length - 1]);
      expect(mockApi.pauseRun).toHaveBeenCalledWith(RUN_ID);
      expect(onAction).toHaveBeenCalledTimes(1);

      await userEvent.click(screen.getByRole("button", { name: /Retry Execution/i }));
      await userEvent.click(screen.getByRole("button", { name: "Retry" }));
      expect(mockApi.retryStage).toHaveBeenCalledWith(RUN_ID);
      expect(onAction).toHaveBeenCalledTimes(2);
    });
  });

  describe("Resume-eligible states", () => {
    it.each(["AIBlocked", "HumanClarificationNeeded", "Failed"])(
      "%s shows a Resume button that calls api.resumeRun",
      async (state) => {
        const onAction = vi.fn();
        render(<ActionBar runId={RUN_ID} state={state} onAction={onAction} />);

        await userEvent.click(screen.getByRole("button", { name: /^Resume$/i }));
        const resumeConfirmButtons = screen.getAllByRole("button", { name: "Resume" });
        await userEvent.click(resumeConfirmButtons[resumeConfirmButtons.length - 1]);

        expect(mockApi.resumeRun).toHaveBeenCalledWith(RUN_ID);
        expect(onAction).toHaveBeenCalledTimes(1);
      },
    );

    it("HumanClarificationNeeded also shows an Answer Questions button invoking onScrollToQuestions", async () => {
      const onScrollToQuestions = vi.fn();
      render(
        <ActionBar
          runId={RUN_ID}
          state="HumanClarificationNeeded"
          onAction={vi.fn()}
          onScrollToQuestions={onScrollToQuestions}
        />,
      );
      await userEvent.click(screen.getByRole("button", { name: /Answer Questions/i }));
      expect(onScrollToQuestions).toHaveBeenCalledTimes(1);
    });
  });

  describe("loading and error handling", () => {
    it("shows a 'Working...' spinner and disables the confirm button while the action is pending", async () => {
      let resolveAction!: () => void;
      mockApi.pauseRun.mockReturnValue(
        new Promise<void>((res) => {
          resolveAction = res;
        }),
      );
      render(<ActionBar runId={RUN_ID} state="Implementing" onAction={vi.fn()} />);

      await userEvent.click(screen.getByRole("button", { name: /^Pause$/i }));
      const pauseConfirmButtons = screen.getAllByRole("button", { name: "Pause" });
      await userEvent.click(pauseConfirmButtons[pauseConfirmButtons.length - 1]);

      expect(screen.getByText("Working...")).toBeDefined();
      expect(
        (screen.getByRole("button", { name: /Working/i }) as HTMLButtonElement).disabled,
      ).toBe(true);

      resolveAction();
      await screen.findByRole("button", { name: /^Pause$/i });
    });

    it("does not call onAction and still closes the dialog when the action rejects", async () => {
      const onAction = vi.fn();
      mockApi.pauseRun.mockRejectedValue(new Error("network error"));
      render(<ActionBar runId={RUN_ID} state="Implementing" onAction={onAction} />);

      await userEvent.click(screen.getByRole("button", { name: /^Pause$/i }));
      const pauseConfirmButtons = screen.getAllByRole("button", { name: "Pause" });
      await userEvent.click(pauseConfirmButtons[pauseConfirmButtons.length - 1]);

      await screen.findByRole("button", { name: /^Pause$/i });
      expect(onAction).not.toHaveBeenCalled();
    });

    it("Reject Plan: does not call onAction and resets state when api.rejectPlan rejects", async () => {
      const onAction = vi.fn();
      mockApi.rejectPlan.mockRejectedValue(new Error("boom"));
      render(<ActionBar runId={RUN_ID} state="AwaitingPlanApproval" onAction={onAction} />);

      await userEvent.click(screen.getByRole("button", { name: /^Reject Plan$/i }));
      const confirmButtons = screen.getAllByRole("button", { name: "Reject Plan" });
      await userEvent.click(confirmButtons[confirmButtons.length - 1]);

      await screen.findByRole("button", { name: /^Approve Plan$/i });
      expect(onAction).not.toHaveBeenCalled();
      expect(screen.queryByText(/This will reject the current plan/i)).toBeNull();
    });
  });
});
