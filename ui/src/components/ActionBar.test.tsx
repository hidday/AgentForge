import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
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

const mockApi = api as unknown as {
  approvePlan: ReturnType<typeof vi.fn>;
  rejectPlan: ReturnType<typeof vi.fn>;
  reReviewPlan: ReturnType<typeof vi.fn>;
  revisePlan: ReturnType<typeof vi.fn>;
  approveReview: ReturnType<typeof vi.fn>;
  pauseRun: ReturnType<typeof vi.fn>;
  resumeRun: ReturnType<typeof vi.fn>;
  retryStage: ReturnType<typeof vi.fn>;
}

const RUN_ID = "run-123";

function resolveAll() {
  mockApi.approvePlan.mockResolvedValue({ ok: true, state: "Implementing" });
  mockApi.rejectPlan.mockResolvedValue({ ok: true, state: "Planning" });
  mockApi.reReviewPlan.mockResolvedValue({ ok: true, runId: RUN_ID });
  mockApi.revisePlan.mockResolvedValue({ ok: true, runId: RUN_ID });
  mockApi.approveReview.mockResolvedValue({ ok: true, state: "Done" });
  mockApi.pauseRun.mockResolvedValue({ ok: true });
  mockApi.resumeRun.mockResolvedValue({ ok: true });
  mockApi.retryStage.mockResolvedValue({ ok: true, state: "Planning", retrying: true });
}

describe("ActionBar", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resolveAll();
  });

  describe("visibility by run state", () => {
    it("renders nothing for a state with no applicable actions (Done)", () => {
      const { container } = render(
        <ActionBar runId={RUN_ID} state="Done" onAction={vi.fn()} />,
      );
      expect(container.firstChild).toBeNull();
    });

    it("shows only the 'Start Run' retry button for Todo", () => {
      render(<ActionBar runId={RUN_ID} state="Todo" onAction={vi.fn()} />);
      expect(screen.getByRole("button", { name: /start run/i })).toBeDefined();
      expect(screen.queryByRole("button", { name: /pause/i })).toBeNull();
      expect(screen.queryByRole("button", { name: /approve plan/i })).toBeNull();
    });

    it("shows Approve Plan, Reject Plan, Re-review Plan and Revise Plan for AwaitingPlanApproval", () => {
      render(
        <ActionBar runId={RUN_ID} state="AwaitingPlanApproval" onAction={vi.fn()} />,
      );
      expect(screen.getByRole("button", { name: "Approve Plan" })).toBeDefined();
      expect(screen.getByRole("button", { name: "Reject Plan" })).toBeDefined();
      expect(screen.getByRole("button", { name: /re-review plan/i })).toBeDefined();
      expect(screen.getByRole("button", { name: /revise plan/i })).toBeDefined();
      // No pause/retry/resume for this state
      expect(screen.queryByRole("button", { name: /pause/i })).toBeNull();
      expect(screen.queryByRole("button", { name: /resume/i })).toBeNull();
    });

    it("does not show Answer Optional Questions button when hasOptionalQuestions is false", () => {
      render(
        <ActionBar
          runId={RUN_ID}
          state="AwaitingPlanApproval"
          onAction={vi.fn()}
          hasOptionalQuestions={false}
        />,
      );
      expect(screen.queryByRole("button", { name: /answer optional questions/i })).toBeNull();
    });

    it("shows Answer Optional Questions button when hasOptionalQuestions is true", () => {
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
      const btn = screen.getByRole("button", { name: /answer optional questions/i });
      expect(btn).toBeDefined();
      return userEvent.click(btn).then(() => {
        expect(onScrollToQuestions).toHaveBeenCalledOnce();
        expect(mockApi.approvePlan).not.toHaveBeenCalled();
      });
    });

    it("shows Approve & Complete for ReadyForHumanReview and nothing else", () => {
      render(
        <ActionBar runId={RUN_ID} state="ReadyForHumanReview" onAction={vi.fn()} />,
      );
      expect(screen.getByRole("button", { name: /approve & complete/i })).toBeDefined();
      expect(screen.queryByRole("button", { name: /pause/i })).toBeNull();
      expect(screen.queryByRole("button", { name: "Approve Plan" })).toBeNull();
    });

    it("shows both Pause and Retry for an active+retryable state (Implementing)", () => {
      render(<ActionBar runId={RUN_ID} state="Implementing" onAction={vi.fn()} />);
      expect(screen.getByRole("button", { name: /pause/i })).toBeDefined();
      expect(screen.getByRole("button", { name: /retry execution/i })).toBeDefined();
    });

    it("shows Resume for AIBlocked, HumanClarificationNeeded, and Failed", () => {
      for (const state of ["AIBlocked", "HumanClarificationNeeded", "Failed"]) {
        const { unmount } = render(
          <ActionBar runId={RUN_ID} state={state} onAction={vi.fn()} />,
        );
        expect(screen.getByRole("button", { name: /resume/i })).toBeDefined();
        unmount();
      }
    });

    it("shows Answer Questions button (and Resume) for HumanClarificationNeeded", () => {
      render(
        <ActionBar runId={RUN_ID} state="HumanClarificationNeeded" onAction={vi.fn()} />,
      );
      expect(screen.getByRole("button", { name: /answer questions/i })).toBeDefined();
      expect(screen.getByRole("button", { name: /resume/i })).toBeDefined();
    });

    it("maps retry labels per state", () => {
      const cases: Array<[string, RegExp]> = [
        ["Todo", /start run/i],
        ["Planning", /retry planning/i],
        ["PlanRevision", /retry plan revision/i],
        ["PlanReview", /retry plan review/i],
        ["Implementing", /retry execution/i],
        ["AIReview", /retry code review/i],
        ["AddressingReview", /retry remediation/i],
      ];
      for (const [state, label] of cases) {
        const { unmount } = render(
          <ActionBar runId={RUN_ID} state={state} onAction={vi.fn()} />,
        );
        expect(screen.getByRole("button", { name: label })).toBeDefined();
        unmount();
      }
    });
  });

  describe("Answer Questions button", () => {
    it("calls onScrollToQuestions directly without any api call or dialog", async () => {
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
      expect(mockApi.resumeRun).not.toHaveBeenCalled();
      expect(screen.queryByText(/resume run\?/i)).toBeNull();
    });
  });

  describe("Approve Plan (dialog with notes)", () => {
    it("opens a confirm dialog, sends the typed note, calls api and onAction, then closes", async () => {
      const onAction = vi.fn();
      render(
        <ActionBar runId={RUN_ID} state="AwaitingPlanApproval" onAction={onAction} />,
      );

      await userEvent.click(screen.getByRole("button", { name: "Approve Plan" }));

      expect(screen.getByText(/this will approve the current plan/i)).toBeDefined();
      const textarea = screen.getByPlaceholderText(/extra context, edge cases/i);
      await userEvent.type(textarea, "  watch the auth flow  ");

      await userEvent.click(screen.getByRole("button", { name: /approve & start/i }));

      await waitFor(() => {
        expect(mockApi.approvePlan).toHaveBeenCalledWith(RUN_ID, "watch the auth flow");
      });
      expect(onAction).toHaveBeenCalledOnce();
      await waitFor(() => {
        expect(screen.queryByText(/this will approve the current plan/i)).toBeNull();
      });
    });

    it("sends undefined note when the textarea is left blank", async () => {
      const onAction = vi.fn();
      render(
        <ActionBar runId={RUN_ID} state="AwaitingPlanApproval" onAction={onAction} />,
      );
      await userEvent.click(screen.getByRole("button", { name: "Approve Plan" }));
      await userEvent.click(screen.getByRole("button", { name: /approve & start/i }));

      await waitFor(() => {
        expect(mockApi.approvePlan).toHaveBeenCalledWith(RUN_ID, undefined);
      });
      expect(onAction).toHaveBeenCalledOnce();
    });

    it("cancelling the dialog does not call the api", async () => {
      const onAction = vi.fn();
      render(
        <ActionBar runId={RUN_ID} state="AwaitingPlanApproval" onAction={onAction} />,
      );
      await userEvent.click(screen.getByRole("button", { name: "Approve Plan" }));
      expect(screen.getByText(/this will approve the current plan/i)).toBeDefined();

      await userEvent.click(screen.getByRole("button", { name: /cancel/i }));

      expect(mockApi.approvePlan).not.toHaveBeenCalled();
      expect(onAction).not.toHaveBeenCalled();
      expect(screen.queryByText(/this will approve the current plan/i)).toBeNull();
    });

    it("shows a loading state and disables buttons while the request is pending", async () => {
      let resolveFn!: (v: unknown) => void;
      mockApi.approvePlan.mockReturnValue(
        new Promise((res) => {
          resolveFn = res;
        }),
      );
      const onAction = vi.fn();
      render(
        <ActionBar runId={RUN_ID} state="AwaitingPlanApproval" onAction={onAction} />,
      );
      await userEvent.click(screen.getByRole("button", { name: "Approve Plan" }));
      await userEvent.click(screen.getByRole("button", { name: /approve & start/i }));

      expect(screen.getByText(/working\.\.\./i)).toBeDefined();
      const cancelBtn = screen.getByRole("button", { name: /cancel/i });
      expect((cancelBtn as HTMLButtonElement).disabled).toBe(true);

      resolveFn({ ok: true, state: "Implementing" });

      await waitFor(() => {
        expect(onAction).toHaveBeenCalledOnce();
      });
    });

    it("on api failure, swallows the error, does not call onAction, but still closes the dialog", async () => {
      mockApi.approvePlan.mockRejectedValue(new Error("network down"));
      const onAction = vi.fn();
      render(
        <ActionBar runId={RUN_ID} state="AwaitingPlanApproval" onAction={onAction} />,
      );
      await userEvent.click(screen.getByRole("button", { name: "Approve Plan" }));
      await userEvent.click(screen.getByRole("button", { name: /approve & start/i }));

      await waitFor(() => {
        expect(mockApi.approvePlan).toHaveBeenCalledOnce();
      });
      expect(onAction).not.toHaveBeenCalled();
      await waitFor(() => {
        expect(screen.queryByText(/this will approve the current plan/i)).toBeNull();
      });
    });
  });

  describe("Reject Plan (custom dialog)", () => {
    it("defaults to 'iterate' mode and sends trimmed context", async () => {
      const onAction = vi.fn();
      render(
        <ActionBar runId={RUN_ID} state="AwaitingPlanApproval" onAction={onAction} />,
      );
      await userEvent.click(screen.getByRole("button", { name: "Reject Plan" }));

      expect(
        screen.getByText(/this will reject the current plan and send it back/i),
      ).toBeDefined();

      const textarea = screen.getByPlaceholderText(/describe what should change/i);
      await userEvent.type(textarea, "  needs more tests  ");

      const dialog = screen.getByText(/this will reject the current plan/i).closest("div")!
        .parentElement as HTMLElement;
      const confirmBtn = within(dialog).getByRole("button", { name: "Reject Plan" });
      await userEvent.click(confirmBtn);

      await waitFor(() => {
        expect(mockApi.rejectPlan).toHaveBeenCalledWith(RUN_ID, "needs more tests", "iterate");
      });
      expect(onAction).toHaveBeenCalledOnce();
    });

    it("switches to 'fresh' mode when selected and sends it", async () => {
      const onAction = vi.fn();
      render(
        <ActionBar runId={RUN_ID} state="AwaitingPlanApproval" onAction={onAction} />,
      );
      await userEvent.click(screen.getByRole("button", { name: "Reject Plan" }));

      await userEvent.click(screen.getByRole("button", { name: /start fresh/i }));

      const dialog = screen.getByText(/this will reject the current plan/i).closest("div")!
        .parentElement as HTMLElement;
      const confirmBtn = within(dialog).getByRole("button", { name: "Reject Plan" });
      await userEvent.click(confirmBtn);

      await waitFor(() => {
        expect(mockApi.rejectPlan).toHaveBeenCalledWith(RUN_ID, undefined, "fresh");
      });
      expect(onAction).toHaveBeenCalledOnce();
    });

    it("can switch from 'fresh' back to 'iterate' mode before confirming", async () => {
      const onAction = vi.fn();
      render(
        <ActionBar runId={RUN_ID} state="AwaitingPlanApproval" onAction={onAction} />,
      );
      await userEvent.click(screen.getByRole("button", { name: "Reject Plan" }));

      await userEvent.click(screen.getByRole("button", { name: /start fresh/i }));
      // "Revise plan" (lowercase p) is the mode-toggle button inside the reject
      // dialog; it is distinct from the "Revise Plan" action-bar button.
      await userEvent.click(screen.getByText("Revise plan"));

      const dialog = screen.getByText(/this will reject the current plan/i).closest("div")!
        .parentElement as HTMLElement;
      const confirmBtn = within(dialog).getByRole("button", { name: "Reject Plan" });
      await userEvent.click(confirmBtn);

      await waitFor(() => {
        expect(mockApi.rejectPlan).toHaveBeenCalledWith(RUN_ID, undefined, "iterate");
      });
      expect(onAction).toHaveBeenCalledOnce();
    });

    it("cancelling the reject dialog does not call the api and resets state", async () => {
      const onAction = vi.fn();
      render(
        <ActionBar runId={RUN_ID} state="AwaitingPlanApproval" onAction={onAction} />,
      );
      await userEvent.click(screen.getByRole("button", { name: "Reject Plan" }));
      const textarea = screen.getByPlaceholderText(/describe what should change/i);
      await userEvent.type(textarea, "some feedback");

      await userEvent.click(screen.getByRole("button", { name: /^cancel$/i }));

      expect(mockApi.rejectPlan).not.toHaveBeenCalled();
      expect(onAction).not.toHaveBeenCalled();
      expect(
        screen.queryByText(/this will reject the current plan and send it back/i),
      ).toBeNull();

      // Reopening shows the textarea reset to empty (state was cleared on cancel)
      await userEvent.click(screen.getByRole("button", { name: "Reject Plan" }));
      expect(
        (screen.getByPlaceholderText(/describe what should change/i) as HTMLTextAreaElement)
          .value,
      ).toBe("");
    });

    it("on api failure, swallows the error, does not call onAction, closes the dialog", async () => {
      mockApi.rejectPlan.mockRejectedValue(new Error("server exploded"));
      const onAction = vi.fn();
      render(
        <ActionBar runId={RUN_ID} state="AwaitingPlanApproval" onAction={onAction} />,
      );
      await userEvent.click(screen.getByRole("button", { name: "Reject Plan" }));
      const dialog = screen.getByText(/this will reject the current plan/i).closest("div")!
        .parentElement as HTMLElement;
      await userEvent.click(within(dialog).getByRole("button", { name: "Reject Plan" }));

      await waitFor(() => {
        expect(mockApi.rejectPlan).toHaveBeenCalledOnce();
      });
      expect(onAction).not.toHaveBeenCalled();
      await waitFor(() => {
        expect(
          screen.queryByText(/this will reject the current plan and send it back/i),
        ).toBeNull();
      });
    });
  });

  describe("Re-review Plan / Revise Plan", () => {
    it("Re-review Plan opens a dialog and calls api.reReviewPlan with the note", async () => {
      const onAction = vi.fn();
      render(
        <ActionBar runId={RUN_ID} state="AwaitingPlanApproval" onAction={onAction} />,
      );
      await userEvent.click(screen.getByRole("button", { name: /re-review plan/i }));
      expect(screen.getByText(/run the plan reviewer again/i)).toBeDefined();

      const textarea = screen.getByPlaceholderText(/focus on the test plan/i);
      await userEvent.type(textarea, "check risk section");
      await userEvent.click(screen.getByRole("button", { name: /^re-review$/i }));

      await waitFor(() => {
        expect(mockApi.reReviewPlan).toHaveBeenCalledWith(RUN_ID, "check risk section");
      });
      expect(onAction).toHaveBeenCalledOnce();
    });

    it("Revise Plan opens a dialog and calls api.revisePlan with the note", async () => {
      const onAction = vi.fn();
      render(
        <ActionBar runId={RUN_ID} state="AwaitingPlanApproval" onAction={onAction} />,
      );
      await userEvent.click(screen.getByRole("button", { name: /revise plan/i }));
      expect(screen.getByText(/run the plan reviewer and, if changes/i)).toBeDefined();

      await userEvent.click(screen.getByRole("button", { name: /^revise$/i }));

      await waitFor(() => {
        expect(mockApi.revisePlan).toHaveBeenCalledWith(RUN_ID, undefined);
      });
      expect(onAction).toHaveBeenCalledOnce();
    });
  });

  describe("Approve & Complete (no notes dialog)", () => {
    it("calls api.approveReview(runId) with no note and renders no notes textarea", async () => {
      const onAction = vi.fn();
      render(
        <ActionBar runId={RUN_ID} state="ReadyForHumanReview" onAction={onAction} />,
      );
      await userEvent.click(screen.getByRole("button", { name: /approve & complete/i }));
      expect(screen.getByText(/mark the run as complete/i)).toBeDefined();
      expect(screen.queryByRole("textbox")).toBeNull();

      await userEvent.click(screen.getByRole("button", { name: /complete run/i }));

      await waitFor(() => {
        expect(mockApi.approveReview).toHaveBeenCalledWith(RUN_ID);
      });
      expect(onAction).toHaveBeenCalledOnce();
    });
  });

  describe("Pause / Resume / Retry (no notes dialogs)", () => {
    it("Pause calls api.pauseRun(runId)", async () => {
      const onAction = vi.fn();
      render(<ActionBar runId={RUN_ID} state="Implementing" onAction={onAction} />);
      await userEvent.click(screen.getByRole("button", { name: /^pause$/i }));
      // The confirm dialog's confirm button shares the same label ("Pause") as
      // the trigger button, so there are now two matches — the second is the
      // dialog's confirm button.
      const pauseButtons = screen.getAllByRole("button", { name: /^pause$/i });
      expect(pauseButtons).toHaveLength(2);
      await userEvent.click(pauseButtons[1]);

      await waitFor(() => {
        expect(mockApi.pauseRun).toHaveBeenCalledWith(RUN_ID);
      });
      expect(onAction).toHaveBeenCalledOnce();
    });

    it("Resume calls api.resumeRun(runId)", async () => {
      const onAction = vi.fn();
      render(<ActionBar runId={RUN_ID} state="AIBlocked" onAction={onAction} />);
      await userEvent.click(screen.getByRole("button", { name: /^resume$/i }));
      expect(screen.getByText(/reset the run back to the start/i)).toBeDefined();
      const resumeButtons = screen.getAllByRole("button", { name: /^resume$/i });
      expect(resumeButtons).toHaveLength(2);
      await userEvent.click(resumeButtons[1]);

      await waitFor(() => {
        expect(mockApi.resumeRun).toHaveBeenCalledWith(RUN_ID);
      });
      expect(onAction).toHaveBeenCalledOnce();
    });

    it("Retry calls api.retryStage(runId)", async () => {
      const onAction = vi.fn();
      render(<ActionBar runId={RUN_ID} state="AIReview" onAction={onAction} />);
      await userEvent.click(screen.getByRole("button", { name: /retry code review/i }));
      await userEvent.click(screen.getByRole("button", { name: /^retry$/i }));

      await waitFor(() => {
        expect(mockApi.retryStage).toHaveBeenCalledWith(RUN_ID);
      });
      expect(onAction).toHaveBeenCalledOnce();
    });

    it("cancelling a no-notes dialog (Pause) does not call the api", async () => {
      const onAction = vi.fn();
      render(<ActionBar runId={RUN_ID} state="Implementing" onAction={onAction} />);
      await userEvent.click(screen.getByRole("button", { name: /^pause$/i }));
      await userEvent.click(screen.getByRole("button", { name: /cancel/i }));

      expect(mockApi.pauseRun).not.toHaveBeenCalled();
      expect(onAction).not.toHaveBeenCalled();
    });
  });
});
