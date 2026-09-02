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

  describe("AwaitingPlanApproval", () => {
    it("shows Approve Plan, Reject Plan, Re-review Plan and Revise Plan buttons", () => {
      render(
        <ActionBar runId={RUN_ID} state="AwaitingPlanApproval" onAction={vi.fn()} />,
      );
      expect(screen.getByRole("button", { name: /Approve Plan/i })).toBeDefined();
      expect(screen.getByRole("button", { name: /Reject Plan/i })).toBeDefined();
      expect(screen.getByRole("button", { name: /Re-review Plan/i })).toBeDefined();
      expect(screen.getByRole("button", { name: /Revise Plan/i })).toBeDefined();
    });

    it("does not show Answer Optional Questions when hasOptionalQuestions is false", () => {
      render(
        <ActionBar runId={RUN_ID} state="AwaitingPlanApproval" onAction={vi.fn()} />,
      );
      expect(screen.queryByRole("button", { name: /Answer Optional Questions/i })).toBeNull();
    });

    it("shows Answer Optional Questions when hasOptionalQuestions is true, and it calls onScrollToQuestions", async () => {
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
      const btn = screen.getByRole("button", { name: /Answer Optional Questions/i });
      await userEvent.click(btn);
      expect(onScrollToQuestions).toHaveBeenCalledOnce();
    });

    it("clicking Approve Plan opens a confirm dialog which calls api.approvePlan with the note on confirm", async () => {
      mockApi.approvePlan.mockResolvedValue({ ok: true, state: "Implementing" });
      const onAction = vi.fn();
      render(
        <ActionBar runId={RUN_ID} state="AwaitingPlanApproval" onAction={onAction} />,
      );

      await userEvent.click(screen.getByRole("button", { name: /Approve Plan/i }));

      expect(screen.getByText("This will approve the current plan and start implementation. The AI agent will begin coding.")).toBeDefined();

      const textarea = screen.getByRole("textbox");
      await userEvent.type(textarea, "watch for edge cases");

      await userEvent.click(screen.getByRole("button", { name: "Approve & Start" }));

      await waitFor(() => {
        expect(mockApi.approvePlan).toHaveBeenCalledWith(RUN_ID, "watch for edge cases");
        expect(onAction).toHaveBeenCalledOnce();
      });

      // Dialog closes after success
      expect(screen.queryByRole("button", { name: "Approve & Start" })).toBeNull();
    });

    it("does not call onAction and closes the dialog when the confirmed action rejects", async () => {
      mockApi.approvePlan.mockRejectedValue(new Error("boom"));
      const onAction = vi.fn();
      render(
        <ActionBar runId={RUN_ID} state="AwaitingPlanApproval" onAction={onAction} />,
      );

      await userEvent.click(screen.getByRole("button", { name: /Approve Plan/i }));
      await userEvent.click(screen.getByRole("button", { name: "Approve & Start" }));

      await waitFor(() => {
        expect(mockApi.approvePlan).toHaveBeenCalledOnce();
      });
      expect(onAction).not.toHaveBeenCalled();
      expect(screen.queryByRole("button", { name: "Approve & Start" })).toBeNull();
    });

    it("shows a loading state on the confirm dialog while the approve request is pending", async () => {
      let resolveRequest!: (v: { ok: boolean; state: string }) => void;
      mockApi.approvePlan.mockReturnValue(
        new Promise((res) => {
          resolveRequest = res;
        }),
      );
      render(
        <ActionBar runId={RUN_ID} state="AwaitingPlanApproval" onAction={vi.fn()} />,
      );

      await userEvent.click(screen.getByRole("button", { name: /Approve Plan/i }));
      await userEvent.click(screen.getByRole("button", { name: "Approve & Start" }));

      expect(screen.getByText("Working...")).toBeDefined();

      act(() => {
        resolveRequest({ ok: true, state: "Implementing" });
      });

      await waitFor(() => {
        expect(screen.queryByText("Working...")).toBeNull();
      });
    });

    it("clicking Cancel on the confirm dialog closes it without calling the API", async () => {
      render(
        <ActionBar runId={RUN_ID} state="AwaitingPlanApproval" onAction={vi.fn()} />,
      );
      await userEvent.click(screen.getByRole("button", { name: /Approve Plan/i }));
      await userEvent.click(screen.getByRole("button", { name: "Cancel" }));
      expect(mockApi.approvePlan).not.toHaveBeenCalled();
      expect(screen.queryByRole("button", { name: "Approve & Start" })).toBeNull();
    });

    it("clicking Re-review Plan opens the re-review dialog and calls api.reReviewPlan", async () => {
      mockApi.reReviewPlan.mockResolvedValue({ ok: true, runId: RUN_ID });
      const onAction = vi.fn();
      render(
        <ActionBar runId={RUN_ID} state="AwaitingPlanApproval" onAction={onAction} />,
      );
      await userEvent.click(screen.getByRole("button", { name: /Re-review Plan/i }));
      expect(screen.getByText("Re-review")).toBeDefined();
      await userEvent.click(screen.getByRole("button", { name: "Re-review" }));
      await waitFor(() => {
        expect(mockApi.reReviewPlan).toHaveBeenCalledWith(RUN_ID, undefined);
        expect(onAction).toHaveBeenCalledOnce();
      });
    });

    it("clicking Revise Plan opens the revise dialog and calls api.revisePlan", async () => {
      mockApi.revisePlan.mockResolvedValue({ ok: true, runId: RUN_ID });
      const onAction = vi.fn();
      render(
        <ActionBar runId={RUN_ID} state="AwaitingPlanApproval" onAction={onAction} />,
      );
      await userEvent.click(screen.getByRole("button", { name: /Revise Plan/i }));
      await userEvent.click(screen.getByRole("button", { name: "Revise" }));
      await waitFor(() => {
        expect(mockApi.revisePlan).toHaveBeenCalledWith(RUN_ID, undefined);
        expect(onAction).toHaveBeenCalledOnce();
      });
    });

    describe("Reject Plan custom dialog", () => {
      it("opens the reject dialog defaulting to iterate mode", async () => {
        render(
          <ActionBar runId={RUN_ID} state="AwaitingPlanApproval" onAction={vi.fn()} />,
        );
        await userEvent.click(screen.getByRole("button", { name: "Reject Plan" }));
        expect(
          screen.getByText("This will reject the current plan and send it back for re-planning."),
        ).toBeDefined();
        const reviseModeBtn = screen.getByRole("button", { name: /Revise plan Iterate with full context/ });
        expect(reviseModeBtn.className).toContain("bg-accent");
      });

      it("submits with mode 'iterate' and trimmed feedback by default", async () => {
        mockApi.rejectPlan.mockResolvedValue({ ok: true, state: "Planning" });
        const onAction = vi.fn();
        render(
          <ActionBar runId={RUN_ID} state="AwaitingPlanApproval" onAction={onAction} />,
        );
        await userEvent.click(screen.getByRole("button", { name: "Reject Plan" }));

        const feedback = screen.getByPlaceholderText(/describe what should change/i);
        await userEvent.type(feedback, "  needs more detail  ");

        const confirmButtons = screen.getAllByRole("button", { name: "Reject Plan" });
        await userEvent.click(confirmButtons[confirmButtons.length - 1]);

        await waitFor(() => {
          expect(mockApi.rejectPlan).toHaveBeenCalledWith(RUN_ID, "needs more detail", "iterate");
          expect(onAction).toHaveBeenCalledOnce();
        });
        // Dialog should be closed after success
        expect(screen.queryByPlaceholderText(/describe what should change/i)).toBeNull();
      });

      it("submits with mode 'fresh' after selecting the Start fresh option, and undefined feedback when left blank", async () => {
        mockApi.rejectPlan.mockResolvedValue({ ok: true, state: "Planning" });
        render(
          <ActionBar runId={RUN_ID} state="AwaitingPlanApproval" onAction={vi.fn()} />,
        );
        await userEvent.click(screen.getByRole("button", { name: "Reject Plan" }));

        await userEvent.click(
          screen.getByRole("button", { name: /Start fresh Clean slate, feedback only/ }),
        );

        const confirmButtons = screen.getAllByRole("button", { name: "Reject Plan" });
        await userEvent.click(confirmButtons[confirmButtons.length - 1]);

        await waitFor(() => {
          expect(mockApi.rejectPlan).toHaveBeenCalledWith(RUN_ID, undefined, "fresh");
        });
      });

      it("can toggle back to 'iterate' mode after selecting 'fresh'", async () => {
        mockApi.rejectPlan.mockResolvedValue({ ok: true, state: "Planning" });
        render(
          <ActionBar runId={RUN_ID} state="AwaitingPlanApproval" onAction={vi.fn()} />,
        );
        await userEvent.click(screen.getByRole("button", { name: "Reject Plan" }));

        const freshBtn = screen.getByRole("button", {
          name: /Start fresh Clean slate, feedback only/,
        });
        await userEvent.click(freshBtn);
        expect(freshBtn.className).toContain("bg-accent");

        const iterateBtn = screen.getByRole("button", {
          name: /Revise plan Iterate with full context/,
        });
        await userEvent.click(iterateBtn);
        expect(iterateBtn.className).toContain("bg-accent");
        expect(freshBtn.className).not.toContain("bg-accent");

        const confirmButtons = screen.getAllByRole("button", { name: "Reject Plan" });
        await userEvent.click(confirmButtons[confirmButtons.length - 1]);

        await waitFor(() => {
          expect(mockApi.rejectPlan).toHaveBeenCalledWith(RUN_ID, undefined, "iterate");
        });
      });

      it("shows a Working... loading state and disables Cancel while rejecting", async () => {
        let resolveRequest!: (v: { ok: boolean; state: string }) => void;
        mockApi.rejectPlan.mockReturnValue(
          new Promise((res) => {
            resolveRequest = res;
          }),
        );
        render(
          <ActionBar runId={RUN_ID} state="AwaitingPlanApproval" onAction={vi.fn()} />,
        );
        await userEvent.click(screen.getByRole("button", { name: "Reject Plan" }));
        const confirmButtons = screen.getAllByRole("button", { name: "Reject Plan" });
        await userEvent.click(confirmButtons[confirmButtons.length - 1]);

        expect(screen.getByText("Working...")).toBeDefined();
        expect((screen.getByRole("button", { name: "Cancel" }) as HTMLButtonElement).disabled).toBe(
          true,
        );

        act(() => {
          resolveRequest({ ok: true, state: "Planning" });
        });

        await waitFor(() => {
          expect(screen.queryByText("Working...")).toBeNull();
        });
      });

      it("resets mode and feedback and closes without calling the API when cancelled", async () => {
        render(
          <ActionBar runId={RUN_ID} state="AwaitingPlanApproval" onAction={vi.fn()} />,
        );
        await userEvent.click(screen.getByRole("button", { name: "Reject Plan" }));

        const feedback = screen.getByPlaceholderText(/describe what should change/i);
        await userEvent.type(feedback, "some feedback");
        await userEvent.click(
          screen.getByRole("button", { name: /Start fresh Clean slate, feedback only/ }),
        );

        await userEvent.click(screen.getByRole("button", { name: "Cancel" }));

        expect(mockApi.rejectPlan).not.toHaveBeenCalled();
        expect(screen.queryByPlaceholderText(/describe what should change/i)).toBeNull();

        // Reopen: should be back to defaults (iterate mode, empty feedback)
        await userEvent.click(screen.getByRole("button", { name: "Reject Plan" }));
        expect(
          (screen.getByPlaceholderText(/describe what should change/i) as HTMLTextAreaElement)
            .value,
        ).toBe("");
        expect(
          screen.getByRole("button", { name: /Revise plan Iterate with full context/ }).className,
        ).toContain("bg-accent");
      });

      it("clears the reject dialog state when confirmed and closed even on failure", async () => {
        mockApi.rejectPlan.mockRejectedValue(new Error("nope"));
        render(
          <ActionBar runId={RUN_ID} state="AwaitingPlanApproval" onAction={vi.fn()} />,
        );
        await userEvent.click(screen.getByRole("button", { name: "Reject Plan" }));
        const confirmButtons = screen.getAllByRole("button", { name: "Reject Plan" });
        await userEvent.click(confirmButtons[confirmButtons.length - 1]);

        await waitFor(() => {
          expect(mockApi.rejectPlan).toHaveBeenCalledOnce();
        });
        expect(screen.queryByPlaceholderText(/describe what should change/i)).toBeNull();
      });
    });
  });

  describe("ReadyForHumanReview", () => {
    it("shows Approve & Complete and calls api.approveReview on confirm", async () => {
      mockApi.approveReview.mockResolvedValue({ ok: true, state: "Done" });
      const onAction = vi.fn();
      render(<ActionBar runId={RUN_ID} state="ReadyForHumanReview" onAction={onAction} />);

      await userEvent.click(screen.getByRole("button", { name: /Approve & Complete/i }));
      expect(
        screen.getByText("This will mark the run as complete. Make sure you've reviewed the PR."),
      ).toBeDefined();
      // No notes textarea for this dialog
      expect(screen.queryByRole("textbox")).toBeNull();

      await userEvent.click(screen.getByRole("button", { name: "Complete Run" }));
      await waitFor(() => {
        expect(mockApi.approveReview).toHaveBeenCalledWith(RUN_ID);
        expect(onAction).toHaveBeenCalledOnce();
      });
    });
  });

  describe("active-category states (Pause)", () => {
    it("shows a Pause button for an active state and calls api.pauseRun on confirm", async () => {
      mockApi.pauseRun.mockResolvedValue({ ok: true });
      const onAction = vi.fn();
      render(<ActionBar runId={RUN_ID} state="Implementing" onAction={onAction} />);

      await userEvent.click(screen.getByRole("button", { name: /Pause/i }));
      const confirmButtons = screen.getAllByRole("button", { name: "Pause" });
      await userEvent.click(confirmButtons[confirmButtons.length - 1]);

      await waitFor(() => {
        expect(mockApi.pauseRun).toHaveBeenCalledWith(RUN_ID);
        expect(onAction).toHaveBeenCalledOnce();
      });
    });

    it("does not show a Pause button for a non-active state (Todo)", () => {
      render(<ActionBar runId={RUN_ID} state="Todo" onAction={vi.fn()} />);
      expect(screen.queryByRole("button", { name: /^Pause$/i })).toBeNull();
    });
  });

  describe("Resume states", () => {
    it.each(["AIBlocked", "HumanClarificationNeeded", "Failed"])(
      "shows a Resume button for %s and calls api.resumeRun on confirm",
      async (state) => {
        mockApi.resumeRun.mockResolvedValue({ ok: true });
        const onAction = vi.fn();
        render(<ActionBar runId={RUN_ID} state={state} onAction={onAction} />);

        await userEvent.click(screen.getByRole("button", { name: "Resume" }));
        const confirmButtons = screen.getAllByRole("button", { name: "Resume" });
        await userEvent.click(confirmButtons[confirmButtons.length - 1]);

        await waitFor(() => {
          expect(mockApi.resumeRun).toHaveBeenCalledWith(RUN_ID);
          expect(onAction).toHaveBeenCalledOnce();
        });
      },
    );
  });

  describe("Retry states", () => {
    it("shows 'Start Run' label and calls api.retryStage for Todo", async () => {
      mockApi.retryStage.mockResolvedValue({ ok: true, state: "Planning", retrying: true });
      const onAction = vi.fn();
      render(<ActionBar runId={RUN_ID} state="Todo" onAction={onAction} />);

      await userEvent.click(screen.getByRole("button", { name: "Start Run" }));
      expect(screen.getByText(/Re-run the current stage \(Todo\)/)).toBeDefined();
      await userEvent.click(screen.getByRole("button", { name: "Retry" }));

      await waitFor(() => {
        expect(mockApi.retryStage).toHaveBeenCalledWith(RUN_ID);
        expect(onAction).toHaveBeenCalledOnce();
      });
    });

    it("shows both Pause and a state-specific retry label when a state is both active and retryable", async () => {
      render(<ActionBar runId={RUN_ID} state="Planning" onAction={vi.fn()} />);
      expect(screen.getByRole("button", { name: /^Pause$/i })).toBeDefined();
      expect(screen.getByRole("button", { name: "Retry Planning" })).toBeDefined();
    });

    it("does not show a retry button for a state absent from RETRY_LABELS", () => {
      render(<ActionBar runId={RUN_ID} state="ReadyForHumanReview" onAction={vi.fn()} />);
      expect(screen.queryByText(/^Retry/)).toBeNull();
    });
  });

  describe("HumanClarificationNeeded direct action", () => {
    it("shows Answer Questions and calls onScrollToQuestions when clicked", async () => {
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
      expect(onScrollToQuestions).toHaveBeenCalledOnce();
    });
  });

  it("renders multiple simultaneously-applicable buttons without conflict (AwaitingPlanApproval + optional questions)", () => {
    render(
      <ActionBar
        runId={RUN_ID}
        state="AwaitingPlanApproval"
        onAction={vi.fn()}
        hasOptionalQuestions={true}
      />,
    );
    expect(screen.getByRole("button", { name: /Approve Plan/i })).toBeDefined();
    expect(screen.getByRole("button", { name: /Reject Plan/i })).toBeDefined();
    expect(screen.getByRole("button", { name: /Answer Optional Questions/i })).toBeDefined();
    expect(screen.getByRole("button", { name: /Re-review Plan/i })).toBeDefined();
    expect(screen.getByRole("button", { name: /Revise Plan/i })).toBeDefined();
  });
});
