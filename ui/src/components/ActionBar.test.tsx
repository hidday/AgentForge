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

const RUN_ID = "run-42";

describe("ActionBar", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("renders nothing when the state has no applicable actions", () => {
    const { container } = render(
      <ActionBar runId={RUN_ID} state="Done" onAction={vi.fn()} />,
    );
    expect(container.innerHTML).toBe("");
  });

  it("renders nothing for a plain active state with no other flags (e.g. no questions)", () => {
    // Implementing IS an active-category state so Pause should show — use
    // this test instead to confirm the inverse: a state with zero matches.
    const { container } = render(
      <ActionBar runId={RUN_ID} state="Unknown" onAction={vi.fn()} />,
    );
    expect(container.innerHTML).toBe("");
  });

  describe("Approve Plan flow", () => {
    it("opens the confirm dialog with notes and calls approvePlan with the trimmed note", async () => {
      const user = userEvent.setup();
      const onAction = vi.fn();
      mockApi.approvePlan.mockResolvedValue({ ok: true, state: "Implementing" });

      render(
        <ActionBar runId={RUN_ID} state="AwaitingPlanApproval" onAction={onAction} />,
      );

      await user.click(screen.getByRole("button", { name: /^Approve Plan$/ }));

      expect(screen.getByText("Approve Plan", { selector: "h3" })).toBeDefined();
      const textarea = screen.getByPlaceholderText(/extra context/i);
      await user.type(textarea, "  watch the migration  ");
      await user.click(screen.getByRole("button", { name: "Approve & Start" }));

      await waitFor(() => {
        expect(mockApi.approvePlan).toHaveBeenCalledWith(RUN_ID, "watch the migration");
      });
      expect(onAction).toHaveBeenCalledOnce();
      // Dialog closes after confirming.
      await waitFor(() => {
        expect(screen.queryByText("Approve Plan", { selector: "h3" })).toBeNull();
      });
    });

    it("does not call onAction when approvePlan rejects, and still closes the dialog", async () => {
      const user = userEvent.setup();
      const onAction = vi.fn();
      mockApi.approvePlan.mockRejectedValue(new Error("server error"));

      render(
        <ActionBar runId={RUN_ID} state="AwaitingPlanApproval" onAction={onAction} />,
      );
      await user.click(screen.getByRole("button", { name: /^Approve Plan$/ }));
      await user.click(screen.getByRole("button", { name: "Approve & Start" }));

      await waitFor(() => {
        expect(mockApi.approvePlan).toHaveBeenCalledOnce();
      });
      expect(onAction).not.toHaveBeenCalled();
      await waitFor(() => {
        expect(screen.queryByText("Approve Plan", { selector: "h3" })).toBeNull();
      });
    });

    it("shows a loading indicator while the approve action is pending", async () => {
      const user = userEvent.setup();
      let resolveFn: (v: unknown) => void = () => {};
      mockApi.approvePlan.mockReturnValue(
        new Promise((resolve) => {
          resolveFn = resolve;
        }),
      );

      render(
        <ActionBar runId={RUN_ID} state="AwaitingPlanApproval" onAction={vi.fn()} />,
      );
      await user.click(screen.getByRole("button", { name: /^Approve Plan$/ }));
      await user.click(screen.getByRole("button", { name: "Approve & Start" }));

      expect(screen.getByText("Working...")).toBeDefined();
      resolveFn({ ok: true, state: "Implementing" });
      await waitFor(() => {
        expect(screen.queryByText("Working...")).toBeNull();
      });
    });

    it("can be cancelled without calling approvePlan", async () => {
      const user = userEvent.setup();
      render(
        <ActionBar runId={RUN_ID} state="AwaitingPlanApproval" onAction={vi.fn()} />,
      );
      await user.click(screen.getByRole("button", { name: /^Approve Plan$/ }));
      await user.click(screen.getByRole("button", { name: "Cancel" }));

      expect(mockApi.approvePlan).not.toHaveBeenCalled();
      expect(screen.queryByText("Approve Plan", { selector: "h3" })).toBeNull();
    });
  });

  describe("Reject Plan flow", () => {
    it("opens the custom reject dialog defaulting to iterate mode and calls rejectPlan with trimmed context", async () => {
      const user = userEvent.setup();
      const onAction = vi.fn();
      mockApi.rejectPlan.mockResolvedValue({ ok: true, state: "Planning" });

      render(
        <ActionBar runId={RUN_ID} state="AwaitingPlanApproval" onAction={onAction} />,
      );

      const [rejectTrigger] = screen.getAllByRole("button", { name: /^Reject Plan$/ });
      await user.click(rejectTrigger);

      const textarea = screen.getByPlaceholderText(/describe what should change/i);
      await user.type(textarea, "  needs more tests  ");

      const rejectButtons = screen.getAllByRole("button", { name: /^Reject Plan$/ });
      // Confirm button is the last "Reject Plan" labelled button (modal renders after trigger).
      await user.click(rejectButtons[rejectButtons.length - 1]);

      await waitFor(() => {
        expect(mockApi.rejectPlan).toHaveBeenCalledWith(RUN_ID, "needs more tests", "iterate");
      });
      expect(onAction).toHaveBeenCalledOnce();
    });

    it("switches to fresh mode when 'Start fresh' is selected and passes that mode to rejectPlan", async () => {
      const user = userEvent.setup();
      mockApi.rejectPlan.mockResolvedValue({ ok: true, state: "Planning" });

      render(
        <ActionBar runId={RUN_ID} state="AwaitingPlanApproval" onAction={vi.fn()} />,
      );
      const [rejectTrigger] = screen.getAllByRole("button", { name: /^Reject Plan$/ });
      await user.click(rejectTrigger);

      await user.click(screen.getByText("Start fresh"));
      const rejectButtons = screen.getAllByRole("button", { name: /^Reject Plan$/ });
      await user.click(rejectButtons[rejectButtons.length - 1]);

      await waitFor(() => {
        expect(mockApi.rejectPlan).toHaveBeenCalledWith(RUN_ID, undefined, "fresh");
      });
    });

    it("passes undefined context when the feedback textarea is left blank", async () => {
      const user = userEvent.setup();
      mockApi.rejectPlan.mockResolvedValue({ ok: true, state: "Planning" });

      render(
        <ActionBar runId={RUN_ID} state="AwaitingPlanApproval" onAction={vi.fn()} />,
      );
      const [rejectTrigger] = screen.getAllByRole("button", { name: /^Reject Plan$/ });
      await user.click(rejectTrigger);
      const rejectButtons = screen.getAllByRole("button", { name: /^Reject Plan$/ });
      await user.click(rejectButtons[rejectButtons.length - 1]);

      await waitFor(() => {
        expect(mockApi.rejectPlan).toHaveBeenCalledWith(RUN_ID, undefined, "iterate");
      });
    });

    it("cancels via the Cancel button and clears feedback, without calling rejectPlan", async () => {
      const user = userEvent.setup();
      render(
        <ActionBar runId={RUN_ID} state="AwaitingPlanApproval" onAction={vi.fn()} />,
      );
      const [rejectTrigger] = screen.getAllByRole("button", { name: /^Reject Plan$/ });
      await user.click(rejectTrigger);

      const textarea = screen.getByPlaceholderText(/describe what should change/i);
      await user.type(textarea, "abandoned feedback");
      await user.click(screen.getByRole("button", { name: "Cancel" }));

      expect(mockApi.rejectPlan).not.toHaveBeenCalled();
      expect(screen.queryByPlaceholderText(/describe what should change/i)).toBeNull();

      // Reopening should show a cleared textarea (state was reset).
      await user.click(screen.getAllByRole("button", { name: /^Reject Plan$/ })[0]);
      expect(
        (screen.getByPlaceholderText(/describe what should change/i) as HTMLTextAreaElement)
          .value,
      ).toBe("");
    });

    it("allows clicking back to 'Revise plan' (iterate) mode after switching to fresh", async () => {
      const user = userEvent.setup();
      mockApi.rejectPlan.mockResolvedValue({ ok: true, state: "Planning" });

      render(
        <ActionBar runId={RUN_ID} state="AwaitingPlanApproval" onAction={vi.fn()} />,
      );
      const [rejectTrigger] = screen.getAllByRole("button", { name: /^Reject Plan$/ });
      await user.click(rejectTrigger);

      await user.click(screen.getByText("Start fresh"));
      await user.click(screen.getByText("Revise plan"));

      const rejectButtons = screen.getAllByRole("button", { name: /^Reject Plan$/ });
      await user.click(rejectButtons[rejectButtons.length - 1]);

      await waitFor(() => {
        expect(mockApi.rejectPlan).toHaveBeenCalledWith(RUN_ID, undefined, "iterate");
      });
    });

    it("does not call onAction when rejectPlan rejects", async () => {
      const user = userEvent.setup();
      const onAction = vi.fn();
      mockApi.rejectPlan.mockRejectedValue(new Error("nope"));

      render(
        <ActionBar runId={RUN_ID} state="AwaitingPlanApproval" onAction={onAction} />,
      );
      const [rejectTrigger] = screen.getAllByRole("button", { name: /^Reject Plan$/ });
      await user.click(rejectTrigger);
      const rejectButtons = screen.getAllByRole("button", { name: /^Reject Plan$/ });
      await user.click(rejectButtons[rejectButtons.length - 1]);

      await waitFor(() => {
        expect(mockApi.rejectPlan).toHaveBeenCalledOnce();
      });
      expect(onAction).not.toHaveBeenCalled();
    });
  });

  describe("Re-review Plan / Revise Plan buttons", () => {
    it("opens the re-review dialog and calls reReviewPlan", async () => {
      const user = userEvent.setup();
      mockApi.reReviewPlan.mockResolvedValue({ ok: true, runId: RUN_ID });

      render(
        <ActionBar runId={RUN_ID} state="AwaitingPlanApproval" onAction={vi.fn()} />,
      );
      await user.click(screen.getByRole("button", { name: "Re-review Plan" }));
      expect(screen.getByText("Re-review Plan", { selector: "h3" })).toBeDefined();

      await user.click(screen.getByRole("button", { name: "Re-review" }));
      await waitFor(() => {
        expect(mockApi.reReviewPlan).toHaveBeenCalledWith(RUN_ID, undefined);
      });
    });

    it("opens the revise dialog and calls revisePlan with a note", async () => {
      const user = userEvent.setup();
      mockApi.revisePlan.mockResolvedValue({ ok: true, runId: RUN_ID });

      render(
        <ActionBar runId={RUN_ID} state="AwaitingPlanApproval" onAction={vi.fn()} />,
      );
      await user.click(screen.getByRole("button", { name: "Revise Plan" }));
      expect(screen.getByText("Revise Plan", { selector: "h3" })).toBeDefined();

      const textarea = screen.getByPlaceholderText(/tighten the rollout step/i);
      await user.type(textarea, "focus on rollback");
      await user.click(screen.getByRole("button", { name: "Revise" }));

      await waitFor(() => {
        expect(mockApi.revisePlan).toHaveBeenCalledWith(RUN_ID, "focus on rollback");
      });
    });
  });

  describe("Approve & Complete flow", () => {
    it("calls approveReview without notes", async () => {
      const user = userEvent.setup();
      const onAction = vi.fn();
      mockApi.approveReview.mockResolvedValue({ ok: true, state: "Done" });

      render(
        <ActionBar runId={RUN_ID} state="ReadyForHumanReview" onAction={onAction} />,
      );
      await user.click(screen.getByRole("button", { name: "Approve & Complete" }));
      expect(screen.queryByPlaceholderText(/anything the next agent/i)).toBeNull();

      await user.click(screen.getByRole("button", { name: "Complete Run" }));
      await waitFor(() => {
        expect(mockApi.approveReview).toHaveBeenCalledWith(RUN_ID);
      });
      expect(onAction).toHaveBeenCalledOnce();
    });
  });

  describe("Pause flow (active-category states)", () => {
    it("shows Pause for an active state and calls pauseRun on confirm", async () => {
      const user = userEvent.setup();
      mockApi.pauseRun.mockResolvedValue({ ok: true });

      render(<ActionBar runId={RUN_ID} state="Implementing" onAction={vi.fn()} />);
      const [pauseTrigger] = screen.getAllByRole("button", { name: "Pause" });
      await user.click(pauseTrigger);

      const pauseButtons = screen.getAllByRole("button", { name: "Pause" });
      await user.click(pauseButtons[pauseButtons.length - 1]);

      await waitFor(() => {
        expect(mockApi.pauseRun).toHaveBeenCalledWith(RUN_ID);
      });
    });

    it("does not show Pause for a non-active state", () => {
      render(<ActionBar runId={RUN_ID} state="Todo" onAction={vi.fn()} />);
      expect(screen.queryByRole("button", { name: "Pause" })).toBeNull();
    });
  });

  describe("Resume flow", () => {
    it.each(["AIBlocked", "HumanClarificationNeeded", "Failed"])(
      "shows Resume for %s and calls resumeRun on confirm",
      async (state) => {
        const user = userEvent.setup();
        mockApi.resumeRun.mockResolvedValue({ ok: true });

        render(<ActionBar runId={RUN_ID} state={state} onAction={vi.fn()} />);
        const [resumeTrigger] = screen.getAllByRole("button", { name: "Resume" });
        await user.click(resumeTrigger);

        const resumeButtons = screen.getAllByRole("button", { name: "Resume" });
        await user.click(resumeButtons[resumeButtons.length - 1]);

        await waitFor(() => {
          expect(mockApi.resumeRun).toHaveBeenCalledWith(RUN_ID);
        });
      },
    );
  });

  describe("Retry flow", () => {
    it.each([
      ["Todo", "Start Run"],
      ["Planning", "Retry Planning"],
      ["PlanRevision", "Retry Plan Revision"],
      ["PlanReview", "Retry Plan Review"],
      ["Implementing", "Retry Execution"],
      ["AIReview", "Retry Code Review"],
      ["AddressingReview", "Retry Remediation"],
    ])("shows '%s' -> '%s' label and calls retryStage on confirm", async (state, label) => {
      const user = userEvent.setup();
      mockApi.retryStage.mockResolvedValue({ ok: true, state, retrying: true });

      render(<ActionBar runId={RUN_ID} state={state} onAction={vi.fn()} />);
      await user.click(screen.getByRole("button", { name: label }));
      await user.click(screen.getByRole("button", { name: "Retry" }));

      await waitFor(() => {
        expect(mockApi.retryStage).toHaveBeenCalledWith(RUN_ID);
      });
    });
  });

  describe("Answer Questions buttons", () => {
    it("shows 'Answer Questions' for HumanClarificationNeeded and calls onScrollToQuestions", async () => {
      const user = userEvent.setup();
      const onScrollToQuestions = vi.fn();
      render(
        <ActionBar
          runId={RUN_ID}
          state="HumanClarificationNeeded"
          onAction={vi.fn()}
          onScrollToQuestions={onScrollToQuestions}
        />,
      );
      await user.click(screen.getByRole("button", { name: /Answer Questions/ }));
      expect(onScrollToQuestions).toHaveBeenCalledOnce();
    });

    it("shows 'Answer Optional Questions' only when hasOptionalQuestions is true on AwaitingPlanApproval", async () => {
      const user = userEvent.setup();
      const onScrollToQuestions = vi.fn();
      const { rerender } = render(
        <ActionBar
          runId={RUN_ID}
          state="AwaitingPlanApproval"
          onAction={vi.fn()}
          onScrollToQuestions={onScrollToQuestions}
          hasOptionalQuestions={false}
        />,
      );
      expect(screen.queryByRole("button", { name: /Answer Optional Questions/ })).toBeNull();

      rerender(
        <ActionBar
          runId={RUN_ID}
          state="AwaitingPlanApproval"
          onAction={vi.fn()}
          onScrollToQuestions={onScrollToQuestions}
          hasOptionalQuestions={true}
        />,
      );
      await user.click(screen.getByRole("button", { name: /Answer Optional Questions/ }));
      expect(onScrollToQuestions).toHaveBeenCalledOnce();
    });
  });
});
