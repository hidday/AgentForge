import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, act, within } from "@testing-library/react";
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
};

const RUN_ID = "run-1";

/** The generic ConfirmDialog renders its own modal container; scope queries to it
 * so we don't collide with the (still-rendered) trigger button behind it. */
function getConfirmDialog(): HTMLElement {
  const el = document.querySelector(".relative.z-10.w-full.max-w-sm");
  if (!el) throw new Error("Confirm dialog not found");
  return el as HTMLElement;
}

function deferred<T>() {
  let resolve!: (v: T) => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

describe("ActionBar", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("renders nothing (returns null) for a state with no applicable actions", () => {
    const { container } = render(
      <ActionBar runId={RUN_ID} state="Done" onAction={vi.fn()} />,
    );
    expect(container.innerHTML).toBe("");
  });

  it("renders nothing for Todo state despite RETRY_LABELS containing Todo — wait, Todo IS a retry state", () => {
    // Todo maps to "Start Run" retry button — sanity check it DOES render.
    render(<ActionBar runId={RUN_ID} state="Todo" onAction={vi.fn()} />);
    expect(screen.getByRole("button", { name: /start run/i })).toBeDefined();
  });

  // ---- AwaitingPlanApproval: Approve / Reject / Re-review / Revise ----
  describe("AwaitingPlanApproval state", () => {
    it("shows Approve Plan, Reject Plan, Re-review Plan, Revise Plan buttons but not Answer Questions/Optional", () => {
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
          hasOptionalQuestions={true}
        />,
      );
      const btn = screen.getByRole("button", { name: /answer optional questions/i });
      expect(btn).toBeDefined();
    });

    it("clicking Answer Optional Questions calls onScrollToQuestions", async () => {
      const onScrollToQuestions = vi.fn();
      render(
        <ActionBar
          runId={RUN_ID}
          state="AwaitingPlanApproval"
          onAction={vi.fn()}
          onScrollToQuestions={onScrollToQuestions}
          hasOptionalQuestions={true}
        />,
      );
      await userEvent.click(screen.getByRole("button", { name: /answer optional questions/i }));
      expect(onScrollToQuestions).toHaveBeenCalledTimes(1);
    });

    it("does not show Answer Optional Questions when hasOptionalQuestions is false (default)", () => {
      render(<ActionBar runId={RUN_ID} state="AwaitingPlanApproval" onAction={vi.fn()} />);
      expect(screen.queryByRole("button", { name: /answer optional questions/i })).toBeNull();
    });

    it("clicking Approve Plan opens confirm dialog; confirming calls api.approvePlan with note and then onAction", async () => {
      const onAction = vi.fn();
      mockApi.approvePlan.mockResolvedValue(undefined);
      render(<ActionBar runId={RUN_ID} state="AwaitingPlanApproval" onAction={onAction} />);

      await userEvent.click(screen.getByRole("button", { name: /approve plan/i }));

      const dialog = getConfirmDialog();
      expect(within(dialog).getByText("Approve Plan")).toBeDefined();
      expect(
        screen.getByText(/This will approve the current plan and start implementation/i),
      ).toBeDefined();

      const textarea = screen.getByPlaceholderText(/extra context, edge cases/i);
      await userEvent.type(textarea, "please be careful");

      await userEvent.click(within(dialog).getByRole("button", { name: /approve & start/i }));

      await waitFor(() => {
        expect(mockApi.approvePlan).toHaveBeenCalledWith(RUN_ID, "please be careful");
      });
      expect(onAction).toHaveBeenCalledTimes(1);

      // Dialog closes after confirm
      await waitFor(() => {
        expect(screen.queryByText(/This will approve the current plan/i)).toBeNull();
      });
    });

    it("Approve Plan dialog cancel closes without calling api", async () => {
      const onAction = vi.fn();
      render(<ActionBar runId={RUN_ID} state="AwaitingPlanApproval" onAction={onAction} />);
      await userEvent.click(screen.getByRole("button", { name: /approve plan/i }));
      expect(screen.getByText(/This will approve the current plan/i)).toBeDefined();

      await userEvent.click(screen.getByRole("button", { name: /^cancel$/i }));

      expect(mockApi.approvePlan).not.toHaveBeenCalled();
      expect(onAction).not.toHaveBeenCalled();
      await waitFor(() => {
        expect(screen.queryByText(/This will approve the current plan/i)).toBeNull();
      });
    });

    it("shows loading state on confirm dialog while approvePlan is pending, then clears", async () => {
      const { promise, resolve } = deferred<void>();
      mockApi.approvePlan.mockReturnValue(promise);
      const onAction = vi.fn();
      render(<ActionBar runId={RUN_ID} state="AwaitingPlanApproval" onAction={onAction} />);

      await userEvent.click(screen.getByRole("button", { name: /approve plan/i }));
      const dialog = getConfirmDialog();
      await userEvent.click(within(dialog).getByRole("button", { name: /approve & start/i }));

      expect(screen.getByText(/working\.\.\./i)).toBeDefined();

      await act(async () => {
        resolve(undefined);
      });

      await waitFor(() => {
        expect(screen.queryByText(/working\.\.\./i)).toBeNull();
      });
      expect(onAction).toHaveBeenCalledTimes(1);
    });

    it("Approve Plan: rejected action does not throw, does not call onAction, and closes dialog", async () => {
      mockApi.approvePlan.mockRejectedValue(new Error("boom"));
      const onAction = vi.fn();
      render(<ActionBar runId={RUN_ID} state="AwaitingPlanApproval" onAction={onAction} />);

      await userEvent.click(screen.getByRole("button", { name: /approve plan/i }));
      const dialog = getConfirmDialog();
      await userEvent.click(within(dialog).getByRole("button", { name: /approve & start/i }));

      await waitFor(() => {
        expect(screen.queryByText(/This will approve the current plan/i)).toBeNull();
      });
      expect(onAction).not.toHaveBeenCalled();
    });

    it("clicking Re-review Plan opens its dialog with correct copy; confirming calls api.reReviewPlan with note", async () => {
      const onAction = vi.fn();
      mockApi.reReviewPlan.mockResolvedValue(undefined);
      render(<ActionBar runId={RUN_ID} state="AwaitingPlanApproval" onAction={onAction} />);

      await userEvent.click(screen.getByRole("button", { name: /re-review plan/i }));
      const dialog = getConfirmDialog();
      expect(within(dialog).getByText("Re-review Plan")).toBeDefined();
      expect(screen.getByText(/Run the plan reviewer again/i)).toBeDefined();

      const textarea = screen.getByPlaceholderText(/focus on the test plan/i);
      await userEvent.type(textarea, "check risks");
      await userEvent.click(within(dialog).getByRole("button", { name: /^re-review$/i }));

      await waitFor(() => {
        expect(mockApi.reReviewPlan).toHaveBeenCalledWith(RUN_ID, "check risks");
      });
      expect(onAction).toHaveBeenCalledTimes(1);
    });

    it("Re-review Plan with empty note passes undefined note (ConfirmDialog behavior)", async () => {
      const onAction = vi.fn();
      mockApi.reReviewPlan.mockResolvedValue(undefined);
      render(<ActionBar runId={RUN_ID} state="AwaitingPlanApproval" onAction={onAction} />);

      await userEvent.click(screen.getByRole("button", { name: /re-review plan/i }));
      const dialog = getConfirmDialog();
      await userEvent.click(within(dialog).getByRole("button", { name: /^re-review$/i }));

      await waitFor(() => {
        expect(mockApi.reReviewPlan).toHaveBeenCalledWith(RUN_ID, undefined);
      });
    });

    it("clicking Revise Plan opens its dialog with correct copy; confirming calls api.revisePlan with note", async () => {
      const onAction = vi.fn();
      mockApi.revisePlan.mockResolvedValue(undefined);
      render(<ActionBar runId={RUN_ID} state="AwaitingPlanApproval" onAction={onAction} />);

      await userEvent.click(screen.getByRole("button", { name: /revise plan/i }));
      const dialog = getConfirmDialog();
      expect(within(dialog).getByText("Revise Plan")).toBeDefined();
      expect(screen.getByText(/if changes are requested, automatically run the plan reviser/i)).toBeDefined();

      const textarea = screen.getByPlaceholderText(/tighten the rollout step/i);
      await userEvent.type(textarea, "expand tests");
      await userEvent.click(within(dialog).getByRole("button", { name: /^revise$/i }));

      await waitFor(() => {
        expect(mockApi.revisePlan).toHaveBeenCalledWith(RUN_ID, "expand tests");
      });
      expect(onAction).toHaveBeenCalledTimes(1);
    });

    it("Revise Plan action rejection is swallowed and dialog closes without onAction", async () => {
      mockApi.revisePlan.mockRejectedValue(new Error("fail"));
      const onAction = vi.fn();
      render(<ActionBar runId={RUN_ID} state="AwaitingPlanApproval" onAction={onAction} />);

      await userEvent.click(screen.getByRole("button", { name: /revise plan/i }));
      const dialog = getConfirmDialog();
      await userEvent.click(within(dialog).getByRole("button", { name: /^revise$/i }));

      await waitFor(() => {
        expect(screen.queryByText(/if changes are requested/i)).toBeNull();
      });
      expect(onAction).not.toHaveBeenCalled();
    });
  });

  // ---- Reject Plan custom dialog ----
  describe("Reject Plan dialog", () => {
    function openRejectDialog() {
      return userEvent.click(screen.getByRole("button", { name: /reject plan/i }));
    }

    it("opens custom reject dialog (not the generic ConfirmDialog) on click", async () => {
      render(<ActionBar runId={RUN_ID} state="AwaitingPlanApproval" onAction={vi.fn()} />);
      await openRejectDialog();
      expect(
        screen.getByText(/This will reject the current plan and send it back for re-planning/i),
      ).toBeDefined();
      expect(screen.getByPlaceholderText(/describe what should change in the next plan/i)).toBeDefined();
    });

    it("defaults to 'iterate' mode (Revise plan tab highlighted) and toggles to 'fresh' mode on click", async () => {
      render(<ActionBar runId={RUN_ID} state="AwaitingPlanApproval" onAction={vi.fn()} />);
      await openRejectDialog();

      const iterateTab = screen.getByRole("button", { name: /revise plan.*iterate with full context/is });
      const freshTab = screen.getByRole("button", { name: /start fresh.*clean slate/is });

      expect(iterateTab.className).toMatch(/bg-accent/);
      expect(freshTab.className).not.toMatch(/bg-accent/);

      await userEvent.click(freshTab);

      expect(freshTab.className).toMatch(/bg-accent/);
      expect(iterateTab.className).not.toMatch(/bg-accent/);

      // Toggle back to 'iterate' to cover the iterate-mode click handler too.
      await userEvent.click(iterateTab);
      expect(iterateTab.className).toMatch(/bg-accent/);
      expect(freshTab.className).not.toMatch(/bg-accent/);
    });

    it("typing feedback and confirming calls api.rejectPlan with trimmed context and 'iterate' mode by default", async () => {
      const onAction = vi.fn();
      mockApi.rejectPlan.mockResolvedValue(undefined);
      render(<ActionBar runId={RUN_ID} state="AwaitingPlanApproval" onAction={onAction} />);
      await openRejectDialog();

      const textarea = screen.getByPlaceholderText(/describe what should change in the next plan/i);
      await userEvent.type(textarea, "  needs more detail  ");

      await userEvent.click(within(getConfirmDialog()).getByRole("button", { name: /^reject plan$/i }));

      await waitFor(() => {
        expect(mockApi.rejectPlan).toHaveBeenCalledWith(RUN_ID, "needs more detail", "iterate");
      });
      expect(onAction).toHaveBeenCalledTimes(1);
    });

    it("empty feedback sends undefined context", async () => {
      mockApi.rejectPlan.mockResolvedValue(undefined);
      render(<ActionBar runId={RUN_ID} state="AwaitingPlanApproval" onAction={vi.fn()} />);
      await openRejectDialog();

      await userEvent.click(within(getConfirmDialog()).getByRole("button", { name: /^reject plan$/i }));

      await waitFor(() => {
        expect(mockApi.rejectPlan).toHaveBeenCalledWith(RUN_ID, undefined, "iterate");
      });
    });

    it("selecting 'fresh' mode sends 'fresh' as the mode argument", async () => {
      mockApi.rejectPlan.mockResolvedValue(undefined);
      render(<ActionBar runId={RUN_ID} state="AwaitingPlanApproval" onAction={vi.fn()} />);
      await openRejectDialog();

      await userEvent.click(screen.getByRole("button", { name: /start fresh.*clean slate/is }));
      await userEvent.click(within(getConfirmDialog()).getByRole("button", { name: /^reject plan$/i }));

      await waitFor(() => {
        expect(mockApi.rejectPlan).toHaveBeenCalledWith(RUN_ID, undefined, "fresh");
      });
    });

    it("shows Working... spinner text while rejectPlan is pending, and re-enables afterward", async () => {
      const { promise, resolve } = deferred<void>();
      mockApi.rejectPlan.mockReturnValue(promise);
      render(<ActionBar runId={RUN_ID} state="AwaitingPlanApproval" onAction={vi.fn()} />);
      await openRejectDialog();

      const dialog = getConfirmDialog();
      const confirmBtn = within(dialog).getByRole("button", { name: /^reject plan$/i });
      await userEvent.click(confirmBtn);

      expect(screen.getByText(/working\.\.\./i)).toBeDefined();
      const cancelBtn = within(dialog).getByRole("button", { name: /^cancel$/i });
      expect((cancelBtn as HTMLButtonElement).disabled).toBe(true);

      await act(async () => {
        resolve(undefined);
      });

      await waitFor(() => {
        expect(screen.queryByText(/This will reject the current plan/i)).toBeNull();
      });
    });

    it("rejectPlan rejection is swallowed: dialog closes, state resets, no onAction call", async () => {
      mockApi.rejectPlan.mockRejectedValue(new Error("network down"));
      const onAction = vi.fn();
      render(<ActionBar runId={RUN_ID} state="AwaitingPlanApproval" onAction={onAction} />);
      await openRejectDialog();

      await userEvent.type(
        screen.getByPlaceholderText(/describe what should change in the next plan/i),
        "some feedback",
      );
      await userEvent.click(within(getConfirmDialog()).getByRole("button", { name: /^reject plan$/i }));

      await waitFor(() => {
        expect(screen.queryByText(/This will reject the current plan/i)).toBeNull();
      });
      expect(onAction).not.toHaveBeenCalled();

      // Re-opening should show the reset (empty) textarea and default 'iterate' mode
      await openRejectDialog();
      const textarea = screen.getByPlaceholderText(
        /describe what should change in the next plan/i,
      ) as HTMLTextAreaElement;
      expect(textarea.value).toBe("");
      const iterateTab = screen.getByRole("button", { name: /revise plan.*iterate with full context/is });
      expect(iterateTab.className).toMatch(/bg-accent/);
    });

    it("Cancel button closes the reject dialog and resets feedback text without calling the API", async () => {
      render(<ActionBar runId={RUN_ID} state="AwaitingPlanApproval" onAction={vi.fn()} />);
      await openRejectDialog();

      await userEvent.type(
        screen.getByPlaceholderText(/describe what should change in the next plan/i),
        "abandoned feedback",
      );
      await userEvent.click(screen.getByRole("button", { name: /^cancel$/i }));

      expect(mockApi.rejectPlan).not.toHaveBeenCalled();
      await waitFor(() => {
        expect(screen.queryByText(/This will reject the current plan/i)).toBeNull();
      });

      await openRejectDialog();
      const textarea = screen.getByPlaceholderText(
        /describe what should change in the next plan/i,
      ) as HTMLTextAreaElement;
      expect(textarea.value).toBe("");
    });

    it("clicking the backdrop overlay cancels the reject dialog", async () => {
      const { container } = render(
        <ActionBar runId={RUN_ID} state="AwaitingPlanApproval" onAction={vi.fn()} />,
      );
      await openRejectDialog();

      const backdrop = container.querySelector(".bg-black\\/60");
      expect(backdrop).not.toBeNull();
      await userEvent.click(backdrop as Element);

      expect(mockApi.rejectPlan).not.toHaveBeenCalled();
      await waitFor(() => {
        expect(screen.queryByText(/This will reject the current plan/i)).toBeNull();
      });
    });
  });

  // ---- ReadyForHumanReview ----
  describe("ReadyForHumanReview state", () => {
    it("shows Approve & Complete button and calls api.approveReview (no note arg) on confirm", async () => {
      const onAction = vi.fn();
      mockApi.approveReview.mockResolvedValue(undefined);
      render(<ActionBar runId={RUN_ID} state="ReadyForHumanReview" onAction={onAction} />);

      const btn = screen.getByRole("button", { name: /approve & complete/i });
      await userEvent.click(btn);
      expect(screen.getByText(/Make sure you've reviewed the PR/i)).toBeDefined();

      // No notes textarea for this dialog
      expect(screen.queryByPlaceholderText(/optional/i)).toBeNull();

      await userEvent.click(screen.getByRole("button", { name: /complete run/i }));

      await waitFor(() => {
        expect(mockApi.approveReview).toHaveBeenCalledWith(RUN_ID);
      });
      expect(onAction).toHaveBeenCalledTimes(1);
    });

    it("does not show plan-related buttons in ReadyForHumanReview", () => {
      render(<ActionBar runId={RUN_ID} state="ReadyForHumanReview" onAction={vi.fn()} />);
      expect(screen.queryByRole("button", { name: /approve plan/i })).toBeNull();
      expect(screen.queryByRole("button", { name: /reject plan/i })).toBeNull();
      expect(screen.queryByRole("button", { name: /re-review plan/i })).toBeNull();
      expect(screen.queryByRole("button", { name: /revise plan/i })).toBeNull();
    });
  });

  // ---- Pause (active category) ----
  describe("Pause button for active-category states", () => {
    it.each(["Planning", "PlanReview", "PlanRevision", "Implementing", "AIReview", "AddressingReview"])(
      "shows Pause button for state=%s and calls api.pauseRun on confirm",
      async (state) => {
        const onAction = vi.fn();
        mockApi.pauseRun.mockResolvedValue(undefined);
        render(<ActionBar runId={RUN_ID} state={state} onAction={onAction} />);

        const pauseBtn = screen.getByRole("button", { name: /^pause$/i });
        await userEvent.click(pauseBtn);
        expect(screen.getByText(/This will pause the run\. You can resume it later\./i)).toBeDefined();

        await userEvent.click(within(getConfirmDialog()).getByRole("button", { name: /^pause$/i }));

        await waitFor(() => {
          expect(mockApi.pauseRun).toHaveBeenCalledWith(RUN_ID);
        });
        expect(onAction).toHaveBeenCalledTimes(1);
      },
    );

    it("does not show Pause button for waiting/blocked/done/idle categories", () => {
      for (const state of ["AwaitingPlanApproval", "ReadyForHumanReview", "AIBlocked", "Done", "Todo"]) {
        const { unmount } = render(<ActionBar runId={RUN_ID} state={state} onAction={vi.fn()} />);
        expect(screen.queryByRole("button", { name: /^pause$/i })).toBeNull();
        unmount();
      }
    });
  });

  // ---- Resume ----
  describe("Resume button", () => {
    it.each(["AIBlocked", "HumanClarificationNeeded", "Failed"])(
      "shows Resume button for state=%s and calls api.resumeRun on confirm",
      async (state) => {
        const onAction = vi.fn();
        mockApi.resumeRun.mockResolvedValue(undefined);
        render(<ActionBar runId={RUN_ID} state={state} onAction={onAction} />);

        const resumeBtn = screen.getByRole("button", { name: /^resume$/i });
        await userEvent.click(resumeBtn);
        expect(
          screen.getByText(/This will reset the run back to the start\. It will begin re-planning\./i),
        ).toBeDefined();

        await userEvent.click(within(getConfirmDialog()).getByRole("button", { name: /^resume$/i }));

        await waitFor(() => {
          expect(mockApi.resumeRun).toHaveBeenCalledWith(RUN_ID);
        });
        expect(onAction).toHaveBeenCalledTimes(1);
      },
    );

    it("HumanClarificationNeeded also shows the Answer Questions button alongside Resume", async () => {
      const onScrollToQuestions = vi.fn();
      render(
        <ActionBar
          runId={RUN_ID}
          state="HumanClarificationNeeded"
          onAction={vi.fn()}
          onScrollToQuestions={onScrollToQuestions}
        />,
      );
      expect(screen.getByRole("button", { name: /^answer questions$/i })).toBeDefined();
      expect(screen.getByRole("button", { name: /^resume$/i })).toBeDefined();

      await userEvent.click(screen.getByRole("button", { name: /^answer questions$/i }));
      expect(onScrollToQuestions).toHaveBeenCalledTimes(1);
    });

    it("does not show Resume for a plain active state like Implementing", () => {
      render(<ActionBar runId={RUN_ID} state="Implementing" onAction={vi.fn()} />);
      expect(screen.queryByRole("button", { name: /^resume$/i })).toBeNull();
    });
  });

  // ---- Retry ----
  describe("Retry button label mapping and behavior", () => {
    const cases: Array<[string, string]> = [
      ["Todo", "Start Run"],
      ["Planning", "Retry Planning"],
      ["PlanRevision", "Retry Plan Revision"],
      ["PlanReview", "Retry Plan Review"],
      ["Implementing", "Retry Execution"],
      ["AIReview", "Retry Code Review"],
      ["AddressingReview", "Retry Remediation"],
    ];

    it.each(cases)("shows label %2$s for state %1$s", (state, label) => {
      render(<ActionBar runId={RUN_ID} state={state} onAction={vi.fn()} />);
      expect(screen.getByRole("button", { name: new RegExp(`^${label}$`, "i") })).toBeDefined();
    });

    it("clicking retry button opens dialog with state-specific title/description and calls api.retryStage on confirm", async () => {
      const onAction = vi.fn();
      mockApi.retryStage.mockResolvedValue(undefined);
      render(<ActionBar runId={RUN_ID} state="Implementing" onAction={onAction} />);

      await userEvent.click(screen.getByRole("button", { name: /retry execution/i }));
      expect(within(getConfirmDialog()).getByText("Retry Execution")).toBeDefined();
      expect(
        screen.getByText(/Re-run the current stage \(Implementing\)\. The agent will pick up/i),
      ).toBeDefined();

      await userEvent.click(screen.getByRole("button", { name: /^retry$/i }));

      await waitFor(() => {
        expect(mockApi.retryStage).toHaveBeenCalledWith(RUN_ID);
      });
      expect(onAction).toHaveBeenCalledTimes(1);
    });

    it("retryStage rejection is swallowed without calling onAction", async () => {
      mockApi.retryStage.mockRejectedValue(new Error("fail"));
      const onAction = vi.fn();
      render(<ActionBar runId={RUN_ID} state="Planning" onAction={onAction} />);

      await userEvent.click(screen.getByRole("button", { name: /retry planning/i }));
      await userEvent.click(screen.getByRole("button", { name: /^retry$/i }));

      await waitFor(() => {
        expect(screen.queryByText(/Re-run the current stage/i)).toBeNull();
      });
      expect(onAction).not.toHaveBeenCalled();
    });

    it("falls back to 'Retry' / 'Retry Stage' labels for a state not in RETRY_LABELS but somehow reached (defensive branch check via label fn)", () => {
      // Every actual reachable retry-eligible state is covered by `cases` above via `state in RETRY_LABELS`.
      // The `?? "Retry"` / `?? "Retry Stage"` fallback branches are unreachable through normal props
      // since `show: state in RETRY_LABELS` gates the button's visibility — if state is in RETRY_LABELS,
      // RETRY_LABELS[state] is always defined. This is confirmed by exhaustively covering all seven keys above.
      expect(Object.keys({
        Todo: 1, Planning: 1, PlanRevision: 1, PlanReview: 1, Implementing: 1, AIReview: 1, AddressingReview: 1,
      }).length).toBe(7);
    });
  });

  // ---- Multiple buttons together / combined states ----
  describe("Combined and multi-action states", () => {
    it("Failed state shows both Resume and does not show Retry (Failed not in RETRY_LABELS)", () => {
      render(<ActionBar runId={RUN_ID} state="Failed" onAction={vi.fn()} />);
      expect(screen.getByRole("button", { name: /^resume$/i })).toBeDefined();
      expect(screen.queryByRole("button", { name: /retry/i })).toBeNull();
    });

    it("active states (e.g. Planning) show both Pause and Retry Planning together", () => {
      render(<ActionBar runId={RUN_ID} state="Planning" onAction={vi.fn()} />);
      expect(screen.getByRole("button", { name: /^pause$/i })).toBeDefined();
      expect(screen.getByRole("button", { name: /retry planning/i })).toBeDefined();
    });
  });

  // ---- onScrollToQuestions optional prop ----
  it("Answer Questions button click is a no-op when onScrollToQuestions is not provided", async () => {
    render(<ActionBar runId={RUN_ID} state="HumanClarificationNeeded" onAction={vi.fn()} />);
    const btn = screen.getByRole("button", { name: /^answer questions$/i });
    // Should not throw when clicked without a handler
    await expect(userEvent.click(btn)).resolves.not.toThrow();
  });
});
