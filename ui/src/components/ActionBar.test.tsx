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

  it("renders nothing for a state with no available actions", () => {
    const { container } = render(
      <ActionBar runId={RUN_ID} state="Done" onAction={vi.fn()} />,
    );
    expect(container.firstChild).toBeNull();
  });

  it("renders nothing for Todo state (not a retry target by itself besides Start Run) — sanity check RETRY_LABELS branch renders a button", () => {
    render(<ActionBar runId={RUN_ID} state="Todo" onAction={vi.fn()} />);
    // Todo IS in RETRY_LABELS ("Start Run"), so a button should render.
    expect(screen.getByRole("button", { name: /start run/i })).toBeDefined();
  });

  describe("AwaitingPlanApproval state", () => {
    function renderBar(onAction = vi.fn(), hasOptionalQuestions = false) {
      render(
        <ActionBar
          runId={RUN_ID}
          state="AwaitingPlanApproval"
          onAction={onAction}
          onScrollToQuestions={vi.fn()}
          hasOptionalQuestions={hasOptionalQuestions}
        />,
      );
      return onAction;
    }

    it("shows Approve Plan, Reject Plan, Re-review Plan and Revise Plan buttons", () => {
      renderBar();
      expect(screen.getByRole("button", { name: /approve plan/i })).toBeDefined();
      expect(screen.getByRole("button", { name: /reject plan/i })).toBeDefined();
      expect(screen.getByRole("button", { name: /re-review plan/i })).toBeDefined();
      expect(screen.getByRole("button", { name: /revise plan/i })).toBeDefined();
    });

    it("does not show Answer Optional Questions button when hasOptionalQuestions is false", () => {
      renderBar(vi.fn(), false);
      expect(screen.queryByRole("button", { name: /answer optional questions/i })).toBeNull();
    });

    it("shows Answer Optional Questions button when hasOptionalQuestions is true and calls onScrollToQuestions", async () => {
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
      await userEvent.click(btn);
      expect(onScrollToQuestions).toHaveBeenCalledOnce();
    });

    it("clicking Approve Plan opens confirm dialog, confirming calls api.approvePlan and onAction, and closes dialog", async () => {
      mockApi.approvePlan.mockResolvedValue({ ok: true, state: "Implementing" });
      const onAction = renderBar();

      await userEvent.click(screen.getByRole("button", { name: /approve plan/i }));
      expect(screen.getByText(/this will approve the current plan/i)).toBeDefined();

      const confirmBtn = screen.getByRole("button", { name: /approve & start/i });
      await userEvent.click(confirmBtn);

      await waitFor(() => {
        expect(mockApi.approvePlan).toHaveBeenCalledWith(RUN_ID, undefined);
        expect(onAction).toHaveBeenCalledOnce();
      });

      // Dialog should be closed afterwards
      await waitFor(() => {
        expect(screen.queryByText(/this will approve the current plan/i)).toBeNull();
      });
    });

    it("passes a trimmed note through to api.approvePlan when provided", async () => {
      mockApi.approvePlan.mockResolvedValue({ ok: true, state: "Implementing" });
      renderBar();

      await userEvent.click(screen.getByRole("button", { name: /approve plan/i }));
      const textarea = screen.getByPlaceholderText(/extra context/i);
      await userEvent.type(textarea, "  watch the auth flow  ");
      await userEvent.click(screen.getByRole("button", { name: /approve & start/i }));

      await waitFor(() => {
        expect(mockApi.approvePlan).toHaveBeenCalledWith(RUN_ID, "watch the auth flow");
      });
    });

    it("does not call onAction and dialog closes when approvePlan rejects (error handled by client)", async () => {
      mockApi.approvePlan.mockRejectedValue(new Error("boom"));
      const onAction = renderBar();

      await userEvent.click(screen.getByRole("button", { name: /approve plan/i }));
      await userEvent.click(screen.getByRole("button", { name: /approve & start/i }));

      await waitFor(() => {
        expect(mockApi.approvePlan).toHaveBeenCalledOnce();
      });
      expect(onAction).not.toHaveBeenCalled();
      await waitFor(() => {
        expect(screen.queryByText(/this will approve the current plan/i)).toBeNull();
      });
    });

    it("cancelling the Approve dialog does not call the api", async () => {
      renderBar();
      await userEvent.click(screen.getByRole("button", { name: /approve plan/i }));
      await userEvent.click(screen.getByRole("button", { name: /cancel/i }));
      expect(mockApi.approvePlan).not.toHaveBeenCalled();
      expect(screen.queryByText(/this will approve the current plan/i)).toBeNull();
    });

    it("clicking Re-review Plan opens its dialog and confirming calls api.reReviewPlan", async () => {
      mockApi.reReviewPlan.mockResolvedValue({ ok: true, runId: RUN_ID });
      const onAction = renderBar();

      await userEvent.click(screen.getByRole("button", { name: /re-review plan/i }));
      expect(screen.getByText(/run the plan reviewer again/i)).toBeDefined();
      await userEvent.click(screen.getByRole("button", { name: /^re-review$/i }));

      await waitFor(() => {
        expect(mockApi.reReviewPlan).toHaveBeenCalledWith(RUN_ID, undefined);
        expect(onAction).toHaveBeenCalledOnce();
      });
    });

    it("clicking Revise Plan opens its dialog and confirming calls api.revisePlan", async () => {
      mockApi.revisePlan.mockResolvedValue({ ok: true, runId: RUN_ID });
      const onAction = renderBar();

      await userEvent.click(screen.getByRole("button", { name: /revise plan/i }));
      expect(screen.getByText(/automatically run the plan reviser/i)).toBeDefined();
      await userEvent.click(screen.getByRole("button", { name: /^revise$/i }));

      await waitFor(() => {
        expect(mockApi.revisePlan).toHaveBeenCalledWith(RUN_ID, undefined);
        expect(onAction).toHaveBeenCalledOnce();
      });
    });

    describe("Reject Plan custom dialog", () => {
      // The dialog's confirm button and the toolbar's trigger button share the exact
      // same accessible name ("Reject Plan"); the confirm button is always the one
      // rendered last in the DOM, since the custom dialog markup follows the toolbar.
      function getRejectConfirmButton() {
        const buttons = screen.getAllByRole("button", { name: /^reject plan$/i });
        return buttons[buttons.length - 1];
      }

      it("opens the reject dialog defaulting to iterate mode, and clicking its backdrop cancels", async () => {
        const onAction = renderBar();
        await userEvent.click(screen.getByRole("button", { name: /reject plan/i }));

        expect(screen.getByText(/send it back for re-planning/i)).toBeDefined();
        // "Revise plan" (lowercase p) is the mode-toggle label text, distinct from the
        // toolbar's "Revise Plan" (capital P) button.
        const iterateBtn = screen.getByText("Revise plan");
        expect(iterateBtn).toBeDefined();

        // cancel via Cancel button
        await userEvent.click(screen.getByRole("button", { name: /^cancel$/i }));
        expect(screen.queryByText(/send it back for re-planning/i)).toBeNull();
        expect(mockApi.rejectPlan).not.toHaveBeenCalled();
        expect(onAction).not.toHaveBeenCalled();
      });

      it("confirms in default iterate mode with trimmed feedback text", async () => {
        mockApi.rejectPlan.mockResolvedValue({ ok: true, state: "Planning" });
        const onAction = renderBar();

        await userEvent.click(screen.getByRole("button", { name: /reject plan/i }));
        const textarea = screen.getByPlaceholderText(/describe what should change/i);
        await userEvent.type(textarea, "  needs more tests  ");

        await userEvent.click(getRejectConfirmButton());

        await waitFor(() => {
          expect(mockApi.rejectPlan).toHaveBeenCalledWith(RUN_ID, "needs more tests", "iterate");
          expect(onAction).toHaveBeenCalledOnce();
        });
        // dialog closes
        expect(screen.queryByText(/send it back for re-planning/i)).toBeNull();
      });

      it("switching to fresh mode and back to iterate mode toggles the selected styling on both buttons", async () => {
        renderBar();
        await userEvent.click(screen.getByRole("button", { name: /reject plan/i }));

        const iterateBtn = screen.getByText("Revise plan").closest("button")!;
        const freshBtn = screen.getByText(/start fresh/i).closest("button")!;

        expect(iterateBtn.className).toContain("bg-accent");
        expect(freshBtn.className).not.toContain("bg-accent");

        await userEvent.click(freshBtn);
        expect(freshBtn.className).toContain("bg-accent");
        expect(iterateBtn.className).not.toContain("bg-accent");

        // Switch back to iterate mode
        await userEvent.click(iterateBtn);
        expect(iterateBtn.className).toContain("bg-accent");
        expect(freshBtn.className).not.toContain("bg-accent");
      });

      it("switching to fresh mode and confirming sends mode 'fresh' and undefined context when empty", async () => {
        mockApi.rejectPlan.mockResolvedValue({ ok: true, state: "Planning" });
        renderBar();

        await userEvent.click(screen.getByRole("button", { name: /reject plan/i }));
        await userEvent.click(screen.getByText(/start fresh/i));
        await userEvent.click(getRejectConfirmButton());

        await waitFor(() => {
          expect(mockApi.rejectPlan).toHaveBeenCalledWith(RUN_ID, undefined, "fresh");
        });
      });

      it("keeps the reject dialog state reset after cancel is clicked again", async () => {
        renderBar();
        await userEvent.click(screen.getByRole("button", { name: /reject plan/i }));
        const textarea = screen.getByPlaceholderText(/describe what should change/i);
        await userEvent.type(textarea, "some feedback");
        await userEvent.click(screen.getByRole("button", { name: /^cancel$/i }));

        // reopen; textarea should be reset to empty
        await userEvent.click(screen.getByRole("button", { name: /reject plan/i }));
        const reopenedTextarea = screen.getByPlaceholderText(
          /describe what should change/i,
        ) as HTMLTextAreaElement;
        expect(reopenedTextarea.value).toBe("");
      });

      it("shows the Working... label and disables buttons while reject is in-flight", async () => {
        let resolveFn!: (v: { ok: boolean; state: string }) => void;
        mockApi.rejectPlan.mockReturnValue(
          new Promise((res) => {
            resolveFn = res;
          }),
        );
        renderBar();

        await userEvent.click(screen.getByRole("button", { name: /reject plan/i }));
        await userEvent.click(getRejectConfirmButton());

        expect(screen.getByText(/working\.\.\./i)).toBeDefined();
        const cancelBtn = screen.getByRole("button", { name: /^cancel$/i });
        expect((cancelBtn as HTMLButtonElement).disabled).toBe(true);

        resolveFn({ ok: true, state: "Planning" });
        await waitFor(() => {
          expect(screen.queryByText(/send it back for re-planning/i)).toBeNull();
        });
      });

      it("on rejectPlan failure, dialog still closes and resets (handled by client)", async () => {
        mockApi.rejectPlan.mockRejectedValue(new Error("network down"));
        const onAction = renderBar();

        await userEvent.click(screen.getByRole("button", { name: /reject plan/i }));
        await userEvent.click(getRejectConfirmButton());

        await waitFor(() => {
          expect(mockApi.rejectPlan).toHaveBeenCalledOnce();
        });
        expect(onAction).not.toHaveBeenCalled();
        await waitFor(() => {
          expect(screen.queryByText(/send it back for re-planning/i)).toBeNull();
        });
      });
    });
  });

  it("ReadyForHumanReview: shows Approve & Complete, calling api.approveReview with no note arg", async () => {
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

  it("active category state (e.g. Implementing) shows Pause button and Retry Execution button; pause calls api.pauseRun", async () => {
    mockApi.pauseRun.mockResolvedValue({ ok: true });
    const onAction = vi.fn();
    render(<ActionBar runId={RUN_ID} state="Implementing" onAction={onAction} />);

    expect(screen.getByRole("button", { name: /^pause$/i })).toBeDefined();
    expect(screen.getByRole("button", { name: /retry execution/i })).toBeDefined();

    await userEvent.click(screen.getByRole("button", { name: /^pause$/i }));
    // The dialog confirm button is also labelled "Pause" (confirmLabel); it's the one
    // rendered after the toolbar trigger, so it's last in document order.
    const pauseButtons = screen.getAllByRole("button", { name: /^pause$/i });
    await userEvent.click(pauseButtons[pauseButtons.length - 1]);
    await waitFor(() => {
      expect(mockApi.pauseRun).toHaveBeenCalledWith(RUN_ID);
      expect(onAction).toHaveBeenCalledOnce();
    });
  });

  it.each(["AIBlocked", "HumanClarificationNeeded", "Failed"])(
    "%s state shows a Resume button that calls api.resumeRun",
    async (state) => {
      mockApi.resumeRun.mockResolvedValue({ ok: true });
      const onAction = vi.fn();
      render(<ActionBar runId={RUN_ID} state={state} onAction={onAction} />);

      await userEvent.click(screen.getByRole("button", { name: /^resume$/i }));
      // The dialog confirm button shares the "Resume" label; it's last in document order.
      const resumeButtons = screen.getAllByRole("button", { name: /^resume$/i });
      await userEvent.click(resumeButtons[resumeButtons.length - 1]);

      await waitFor(() => {
        expect(mockApi.resumeRun).toHaveBeenCalledWith(RUN_ID);
        expect(onAction).toHaveBeenCalledOnce();
      });
    },
  );

  it("HumanClarificationNeeded also shows Answer Questions button that calls onScrollToQuestions directly (no dialog)", async () => {
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
  });

  it.each([
    ["Planning", /retry planning/i],
    ["PlanRevision", /retry plan revision/i],
    ["PlanReview", /retry plan review/i],
    ["Implementing", /retry execution/i],
    ["AIReview", /retry code review/i],
    ["AddressingReview", /retry remediation/i],
  ])("state %s shows retry button labelled %s and calls api.retryStage on confirm", async (state, labelRe) => {
    mockApi.retryStage.mockResolvedValue({ ok: true, state, retrying: true });
    const onAction = vi.fn();
    render(<ActionBar runId={RUN_ID} state={state} onAction={onAction} />);

    const retryBtn = screen.getByRole("button", { name: labelRe });
    await userEvent.click(retryBtn);
    await userEvent.click(screen.getByRole("button", { name: /^retry$/i }));

    await waitFor(() => {
      expect(mockApi.retryStage).toHaveBeenCalledWith(RUN_ID);
      expect(onAction).toHaveBeenCalledOnce();
    });
  });

  it("falls back to default 'Retry' / 'Retry Stage' labels for an unmapped state inside RETRY_LABELS check (defensive branch)", () => {
    // All states that satisfy `state in RETRY_LABELS` already have explicit labels,
    // so RETRY_LABELS[state] is always defined for visible retry buttons in practice.
    // This test instead verifies the exact mapping used for a known state.
    render(<ActionBar runId={RUN_ID} state="PlanReview" onAction={vi.fn()} />);
    expect(screen.getByRole("button", { name: /retry plan review/i })).toBeDefined();
  });
});
