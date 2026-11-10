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

const RUN_ID = "run-123";

/**
 * Some action buttons share their exact label with the confirm button inside
 * the dialog they open (e.g. "Pause", "Resume", "Reject Plan"), so both are
 * simultaneously visible and ambiguous to getByRole. The dialog's confirm
 * button is always rendered after (and is the last match for) the trigger
 * button in the DOM, so we pick the last match.
 */
function getLastButtonNamed(name: RegExp | string) {
  const buttons = screen.getAllByRole("button", { name });
  return buttons[buttons.length - 1];
}

function resolveAllApis() {
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
    resolveAllApis();
  });

  it("renders nothing when the run state has no applicable actions", () => {
    const { container } = render(
      <ActionBar runId={RUN_ID} state="Done" onAction={vi.fn()} />,
    );
    expect(container.firstChild).toBeNull();
  });

  describe("AwaitingPlanApproval state", () => {
    it("shows Approve Plan, Reject Plan, Re-review Plan and Revise Plan buttons", () => {
      render(<ActionBar runId={RUN_ID} state="AwaitingPlanApproval" onAction={vi.fn()} />);
      expect(screen.getByRole("button", { name: /approve plan/i })).toBeDefined();
      expect(screen.getByRole("button", { name: /reject plan/i })).toBeDefined();
      expect(screen.getByRole("button", { name: /re-review plan/i })).toBeDefined();
      expect(screen.getByRole("button", { name: /revise plan/i })).toBeDefined();
      // No optional-questions button unless hasOptionalQuestions is set
      expect(screen.queryByRole("button", { name: /answer optional questions/i })).toBeNull();
    });

    it("shows the Answer Optional Questions button only when hasOptionalQuestions is true", () => {
      render(
        <ActionBar
          runId={RUN_ID}
          state="AwaitingPlanApproval"
          onAction={vi.fn()}
          hasOptionalQuestions={true}
        />,
      );
      expect(screen.getByRole("button", { name: /answer optional questions/i })).toBeDefined();
    });

    it("clicking Answer Optional Questions calls onScrollToQuestions", async () => {
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

    it("Approve Plan opens a confirm dialog; confirming without a note calls api.approvePlan(runId, undefined) and onAction", async () => {
      const onAction = vi.fn();
      render(<ActionBar runId={RUN_ID} state="AwaitingPlanApproval" onAction={onAction} />);
      await userEvent.click(screen.getByRole("button", { name: /approve plan/i }));

      expect(screen.getByText("Approve Plan", { selector: "h3" })).toBeDefined();
      expect(
        screen.getByText(/This will approve the current plan and start implementation/i),
      ).toBeDefined();

      await userEvent.click(screen.getByRole("button", { name: /approve & start/i }));

      await waitFor(() => {
        expect(mockApi.approvePlan).toHaveBeenCalledWith(RUN_ID, undefined);
        expect(onAction).toHaveBeenCalledOnce();
      });

      // Dialog closes after confirming
      await waitFor(() => {
        expect(screen.queryByRole("button", { name: /approve & start/i })).toBeNull();
      });
    });

    it("Approve Plan dialog forwards a trimmed note to api.approvePlan", async () => {
      render(<ActionBar runId={RUN_ID} state="AwaitingPlanApproval" onAction={vi.fn()} />);
      await userEvent.click(screen.getByRole("button", { name: /approve plan/i }));

      const textarea = screen.getByPlaceholderText(/extra context, edge cases/i);
      await userEvent.type(textarea, "  watch the migration  ");
      await userEvent.click(screen.getByRole("button", { name: /approve & start/i }));

      await waitFor(() => {
        expect(mockApi.approvePlan).toHaveBeenCalledWith(RUN_ID, "watch the migration");
      });
    });

    it("Approve Plan: cancelling the dialog does not call the API", async () => {
      const onAction = vi.fn();
      render(<ActionBar runId={RUN_ID} state="AwaitingPlanApproval" onAction={onAction} />);
      await userEvent.click(screen.getByRole("button", { name: /approve plan/i }));
      await userEvent.click(screen.getByRole("button", { name: /^cancel$/i }));

      expect(mockApi.approvePlan).not.toHaveBeenCalled();
      expect(onAction).not.toHaveBeenCalled();
      expect(screen.queryByRole("button", { name: /approve & start/i })).toBeNull();
    });

    it("Approve Plan: when the API call rejects, the dialog still closes and onAction is not called", async () => {
      const onAction = vi.fn();
      mockApi.approvePlan.mockRejectedValue(new Error("boom"));
      render(<ActionBar runId={RUN_ID} state="AwaitingPlanApproval" onAction={onAction} />);
      await userEvent.click(screen.getByRole("button", { name: /approve plan/i }));
      await userEvent.click(screen.getByRole("button", { name: /approve & start/i }));

      await waitFor(() => {
        expect(mockApi.approvePlan).toHaveBeenCalled();
      });
      await waitFor(() => {
        expect(screen.queryByRole("button", { name: /approve & start/i })).toBeNull();
      });
      expect(onAction).not.toHaveBeenCalled();
    });

    it("shows a loading state ('Working...') and disables the dialog's buttons while the approve request is pending", async () => {
      let resolveFn!: (v: unknown) => void;
      mockApi.approvePlan.mockReturnValue(new Promise((res) => (resolveFn = res)));

      render(<ActionBar runId={RUN_ID} state="AwaitingPlanApproval" onAction={vi.fn()} />);
      await userEvent.click(screen.getByRole("button", { name: /approve plan/i }));
      await userEvent.click(screen.getByRole("button", { name: /approve & start/i }));

      expect(screen.getByText("Working...")).toBeDefined();
      const cancelBtn = screen.getByRole("button", { name: /^cancel$/i }) as HTMLButtonElement;
      expect(cancelBtn.disabled).toBe(true);

      resolveFn({ ok: true, state: "Implementing" });
      await waitFor(() => {
        expect(screen.queryByText("Working...")).toBeNull();
      });
    });

    it("Re-review Plan opens a dialog and calls api.reReviewPlan(runId, note) on confirm", async () => {
      const onAction = vi.fn();
      render(<ActionBar runId={RUN_ID} state="AwaitingPlanApproval" onAction={onAction} />);
      await userEvent.click(screen.getByRole("button", { name: /^re-review plan$/i }));

      expect(screen.getByText("Re-review Plan", { selector: "h3" })).toBeDefined();

      const textarea = screen.getByPlaceholderText(/focus on the test plan/i);
      await userEvent.type(textarea, "check the rollback plan");
      await userEvent.click(screen.getByRole("button", { name: /^re-review$/i }));

      await waitFor(() => {
        expect(mockApi.reReviewPlan).toHaveBeenCalledWith(RUN_ID, "check the rollback plan");
        expect(onAction).toHaveBeenCalledOnce();
      });
    });

    it("Revise Plan opens a dialog and calls api.revisePlan(runId, note) on confirm", async () => {
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

    describe("Reject Plan custom dialog", () => {
      it("opens the custom reject dialog (not the generic ConfirmDialog) defaulting to 'Revise plan' mode", async () => {
        render(<ActionBar runId={RUN_ID} state="AwaitingPlanApproval" onAction={vi.fn()} />);
        await userEvent.click(screen.getByRole("button", { name: /^reject plan$/i }));

        expect(
          screen.getByText(/This will reject the current plan and send it back/i),
        ).toBeDefined();
        const iterateBtn = screen.getByText("Revise plan").closest("button")!;
        expect(iterateBtn.className).toContain("bg-accent");
      });

      it("toggles to 'Start fresh' mode and back", async () => {
        render(<ActionBar runId={RUN_ID} state="AwaitingPlanApproval" onAction={vi.fn()} />);
        await userEvent.click(screen.getByRole("button", { name: /^reject plan$/i }));

        const freshBtn = screen.getByRole("button", { name: /start fresh/i });
        await userEvent.click(freshBtn);
        expect(freshBtn.className).toContain("bg-accent");

        const iterateBtn = screen.getByText("Revise plan").closest("button")!;
        await userEvent.click(iterateBtn);
        expect(iterateBtn.className).toContain("bg-accent");
      });

      it("confirms with default mode and no feedback: calls api.rejectPlan(runId, undefined, 'iterate')", async () => {
        const onAction = vi.fn();
        render(<ActionBar runId={RUN_ID} state="AwaitingPlanApproval" onAction={onAction} />);
        await userEvent.click(screen.getByRole("button", { name: /^reject plan$/i }));
        await userEvent.click(getLastButtonNamed(/^reject plan$/i));

        await waitFor(() => {
          expect(mockApi.rejectPlan).toHaveBeenCalledWith(RUN_ID, undefined, "iterate");
          expect(onAction).toHaveBeenCalledOnce();
        });
      });

      it("confirms with 'fresh' mode and trimmed feedback text", async () => {
        render(<ActionBar runId={RUN_ID} state="AwaitingPlanApproval" onAction={vi.fn()} />);
        await userEvent.click(screen.getByRole("button", { name: /^reject plan$/i }));
        await userEvent.click(screen.getByRole("button", { name: /start fresh/i }));

        const textarea = screen.getByPlaceholderText(/describe what should change/i);
        await userEvent.type(textarea, "  needs a rollback step  ");

        await userEvent.click(getLastButtonNamed(/^reject plan$/i));

        await waitFor(() => {
          expect(mockApi.rejectPlan).toHaveBeenCalledWith(RUN_ID, "needs a rollback step", "fresh");
        });
      });

      it("Cancel resets mode and feedback text for the next time the dialog opens", async () => {
        render(<ActionBar runId={RUN_ID} state="AwaitingPlanApproval" onAction={vi.fn()} />);
        await userEvent.click(screen.getByRole("button", { name: /^reject plan$/i }));
        await userEvent.click(screen.getByRole("button", { name: /start fresh/i }));
        const textarea = screen.getByPlaceholderText(/describe what should change/i);
        await userEvent.type(textarea, "some feedback");

        await userEvent.click(screen.getByRole("button", { name: /^cancel$/i }));
        expect(screen.queryByPlaceholderText(/describe what should change/i)).toBeNull();

        await userEvent.click(screen.getByRole("button", { name: /^reject plan$/i }));
        const reopenedTextarea = screen.getByPlaceholderText(
          /describe what should change/i,
        ) as HTMLTextAreaElement;
        expect(reopenedTextarea.value).toBe("");
        const iterateBtn = screen.getByText("Revise plan").closest("button")!;
        expect(iterateBtn.className).toContain("bg-accent");
      });

      it("clicking the backdrop cancels the reject dialog", async () => {
        const { container } = render(
          <ActionBar runId={RUN_ID} state="AwaitingPlanApproval" onAction={vi.fn()} />,
        );
        await userEvent.click(screen.getByRole("button", { name: /^reject plan$/i }));
        const backdrop = container.querySelector(".absolute.inset-0") as HTMLElement;
        expect(backdrop).not.toBeNull();
        await userEvent.click(backdrop);
        expect(screen.queryByPlaceholderText(/describe what should change/i)).toBeNull();
      });

      it("shows a 'Working...' loading state and disables the Cancel/Reject buttons while the request is pending", async () => {
        let resolveFn!: (v: unknown) => void;
        mockApi.rejectPlan.mockReturnValue(new Promise((res) => (resolveFn = res)));

        render(<ActionBar runId={RUN_ID} state="AwaitingPlanApproval" onAction={vi.fn()} />);
        await userEvent.click(screen.getByRole("button", { name: /^reject plan$/i }));
        await userEvent.click(getLastButtonNamed(/^reject plan$/i));

        expect(screen.getByText("Working...")).toBeDefined();
        const cancelBtn = screen.getByRole("button", { name: /^cancel$/i }) as HTMLButtonElement;
        expect(cancelBtn.disabled).toBe(true);

        resolveFn({ ok: true, state: "Planning" });
        await waitFor(() => {
          expect(screen.queryByText("Working...")).toBeNull();
        });
      });

      it("when api.rejectPlan rejects, the dialog still closes, fields reset, and onAction is not called", async () => {
        const onAction = vi.fn();
        mockApi.rejectPlan.mockRejectedValue(new Error("network error"));
        render(<ActionBar runId={RUN_ID} state="AwaitingPlanApproval" onAction={onAction} />);
        await userEvent.click(screen.getByRole("button", { name: /^reject plan$/i }));
        await userEvent.click(getLastButtonNamed(/^reject plan$/i));

        await waitFor(() => {
          expect(mockApi.rejectPlan).toHaveBeenCalled();
        });
        await waitFor(() => {
          expect(screen.queryByPlaceholderText(/describe what should change/i)).toBeNull();
        });
        expect(onAction).not.toHaveBeenCalled();
      });
    });
  });

  it("ReadyForHumanReview: shows Approve & Complete, which calls api.approveReview(runId) with no notes field", async () => {
    const onAction = vi.fn();
    render(<ActionBar runId={RUN_ID} state="ReadyForHumanReview" onAction={onAction} />);

    const openBtn = screen.getByRole("button", { name: /approve & complete/i });
    await userEvent.click(openBtn);

    expect(screen.queryByRole("textbox")).toBeNull();

    await userEvent.click(screen.getByRole("button", { name: /complete run/i }));

    await waitFor(() => {
      expect(mockApi.approveReview).toHaveBeenCalledWith(RUN_ID);
      expect(onAction).toHaveBeenCalledOnce();
    });
  });

  it.each(["Planning", "PlanReview", "PlanRevision", "Implementing", "AIReview", "AddressingReview"])(
    "active state '%s' shows a Pause button that calls api.pauseRun(runId)",
    async (state) => {
      const onAction = vi.fn();
      render(<ActionBar runId={RUN_ID} state={state} onAction={onAction} />);
      await userEvent.click(screen.getByRole("button", { name: /^pause$/i }));
      await userEvent.click(getLastButtonNamed(/^pause$/i));

      await waitFor(() => {
        expect(mockApi.pauseRun).toHaveBeenCalledWith(RUN_ID);
        expect(onAction).toHaveBeenCalledOnce();
      });
    },
  );

  it.each(["AIBlocked", "HumanClarificationNeeded", "Failed"])(
    "state '%s' shows a Resume button that calls api.resumeRun(runId)",
    async (state) => {
      const onAction = vi.fn();
      render(<ActionBar runId={RUN_ID} state={state} onAction={onAction} />);
      await userEvent.click(screen.getByRole("button", { name: /^resume$/i }));
      await userEvent.click(getLastButtonNamed(/^resume$/i));

      await waitFor(() => {
        expect(mockApi.resumeRun).toHaveBeenCalledWith(RUN_ID);
        expect(onAction).toHaveBeenCalledOnce();
      });
    },
  );

  it("does not show a Pause button for AIBlocked (blocked category, not active)", () => {
    render(<ActionBar runId={RUN_ID} state="AIBlocked" onAction={vi.fn()} />);
    expect(screen.queryByRole("button", { name: /^pause$/i })).toBeNull();
  });

  it.each([
    ["Todo", "Start Run"],
    ["Planning", "Retry Planning"],
    ["PlanRevision", "Retry Plan Revision"],
    ["PlanReview", "Retry Plan Review"],
    ["Implementing", "Retry Execution"],
    ["AIReview", "Retry Code Review"],
    ["AddressingReview", "Retry Remediation"],
  ])("state '%s' shows a retry button labeled '%s' that calls api.retryStage(runId)", async (state, label) => {
    const onAction = vi.fn();
    render(<ActionBar runId={RUN_ID} state={state} onAction={onAction} />);
    const openBtn = screen.getByRole("button", { name: new RegExp(`^${label}$`, "i") });
    await userEvent.click(openBtn);
    const confirmBtn = screen.getByRole("button", { name: /^retry$/i });
    await userEvent.click(confirmBtn);

    await waitFor(() => {
      expect(mockApi.retryStage).toHaveBeenCalledWith(RUN_ID);
      expect(onAction).toHaveBeenCalledOnce();
    });
  });

  it("shows both Pause and a Retry button together for a state that is both active and retryable (Planning)", () => {
    render(<ActionBar runId={RUN_ID} state="Planning" onAction={vi.fn()} />);
    expect(screen.getByRole("button", { name: /^pause$/i })).toBeDefined();
    expect(screen.getByRole("button", { name: /retry planning/i })).toBeDefined();
  });

  it("HumanClarificationNeeded: shows both Answer Questions and Resume buttons", () => {
    render(<ActionBar runId={RUN_ID} state="HumanClarificationNeeded" onAction={vi.fn()} />);
    expect(screen.getByRole("button", { name: /^answer questions$/i })).toBeDefined();
    expect(screen.getByRole("button", { name: /^resume$/i })).toBeDefined();
  });

  it("clicking Answer Questions calls onScrollToQuestions", async () => {
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

  it("clicking Answer Questions without an onScrollToQuestions prop does not throw", async () => {
    render(<ActionBar runId={RUN_ID} state="HumanClarificationNeeded" onAction={vi.fn()} />);
    await userEvent.click(screen.getByRole("button", { name: /^answer questions$/i }));
    // no assertion needed beyond "did not throw"
  });
});
