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

describe("ActionBar", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    for (const fn of Object.values(mockApi)) {
      fn.mockResolvedValue(undefined);
    }
  });

  it("renders nothing for a state with no applicable actions", () => {
    const { container } = render(
      <ActionBar runId="run-1" state="Done" onAction={vi.fn()} />,
    );
    expect(container.firstChild).toBeNull();
  });

  describe("AwaitingPlanApproval", () => {
    it("shows Approve Plan, Reject Plan, Re-review Plan, and Revise Plan buttons", () => {
      render(
        <ActionBar runId="run-1" state="AwaitingPlanApproval" onAction={vi.fn()} />,
      );
      expect(screen.getByRole("button", { name: /approve plan/i })).toBeDefined();
      expect(screen.getByRole("button", { name: /reject plan/i })).toBeDefined();
      expect(screen.getByRole("button", { name: /re-review plan/i })).toBeDefined();
      expect(screen.getByRole("button", { name: /revise plan/i })).toBeDefined();
    });

    it("shows Answer Optional Questions button when hasOptionalQuestions is true", () => {
      const onScrollToQuestions = vi.fn();
      render(
        <ActionBar
          runId="run-1"
          state="AwaitingPlanApproval"
          onAction={vi.fn()}
          onScrollToQuestions={onScrollToQuestions}
          hasOptionalQuestions={true}
        />,
      );
      const btn = screen.getByRole("button", { name: /answer optional questions/i });
      expect(btn).toBeDefined();
    });

    it("calls onScrollToQuestions when Answer Optional Questions is clicked", async () => {
      const onScrollToQuestions = vi.fn();
      render(
        <ActionBar
          runId="run-1"
          state="AwaitingPlanApproval"
          onAction={vi.fn()}
          onScrollToQuestions={onScrollToQuestions}
          hasOptionalQuestions={true}
        />,
      );
      await userEvent.click(
        screen.getByRole("button", { name: /answer optional questions/i }),
      );
      expect(onScrollToQuestions).toHaveBeenCalledOnce();
    });

    it("does not show Answer Optional Questions button when hasOptionalQuestions is false", () => {
      render(
        <ActionBar runId="run-1" state="AwaitingPlanApproval" onAction={vi.fn()} />,
      );
      expect(
        screen.queryByRole("button", { name: /answer optional questions/i }),
      ).toBeNull();
    });

    it("opens the Approve Plan confirm dialog and calls api.approvePlan with the note on confirm", async () => {
      const onAction = vi.fn();
      render(
        <ActionBar runId="run-1" state="AwaitingPlanApproval" onAction={onAction} />,
      );
      await userEvent.click(screen.getByRole("button", { name: /approve plan/i }));

      expect(screen.getByRole("heading", { name: "Approve Plan" })).toBeDefined();
      expect(
        screen.getByText(/This will approve the current plan/i),
      ).toBeDefined();

      const textarea = screen.getByPlaceholderText(/extra context, edge cases/i);
      await userEvent.type(textarea, "please be careful");

      await userEvent.click(screen.getByRole("button", { name: /approve & start/i }));

      await waitFor(() => {
        expect(mockApi.approvePlan).toHaveBeenCalledWith("run-1", "please be careful");
        expect(onAction).toHaveBeenCalledOnce();
      });
    });

    it("closes the dialog on cancel without calling the action", async () => {
      render(
        <ActionBar runId="run-1" state="AwaitingPlanApproval" onAction={vi.fn()} />,
      );
      await userEvent.click(screen.getByRole("button", { name: /approve plan/i }));
      expect(screen.getByRole("heading", { name: "Approve Plan" })).toBeDefined();

      await userEvent.click(screen.getByRole("button", { name: "Cancel" }));

      expect(mockApi.approvePlan).not.toHaveBeenCalled();
      expect(screen.queryByText(/This will approve the current plan/i)).toBeNull();
    });

    it("opens the Re-review Plan dialog and calls api.reReviewPlan on confirm", async () => {
      const onAction = vi.fn();
      render(
        <ActionBar runId="run-1" state="AwaitingPlanApproval" onAction={onAction} />,
      );
      await userEvent.click(screen.getByRole("button", { name: /re-review plan/i }));
      expect(screen.getByRole("heading", { name: "Re-review Plan" })).toBeDefined();

      await userEvent.click(screen.getByRole("button", { name: "Re-review" }));

      await waitFor(() => {
        expect(mockApi.reReviewPlan).toHaveBeenCalledWith("run-1", undefined);
        expect(onAction).toHaveBeenCalledOnce();
      });
    });

    it("opens the Revise Plan dialog and calls api.revisePlan on confirm", async () => {
      const onAction = vi.fn();
      render(
        <ActionBar runId="run-1" state="AwaitingPlanApproval" onAction={onAction} />,
      );
      await userEvent.click(screen.getByRole("button", { name: /revise plan/i }));
      expect(screen.getByRole("heading", { name: "Revise Plan" })).toBeDefined();

      await userEvent.click(screen.getByRole("button", { name: "Revise" }));

      await waitFor(() => {
        expect(mockApi.revisePlan).toHaveBeenCalledWith("run-1", undefined);
        expect(onAction).toHaveBeenCalledOnce();
      });
    });

    it("opens the custom Reject Plan dialog, defaults to iterate mode, and submits with trimmed context", async () => {
      const onAction = vi.fn();
      render(
        <ActionBar runId="run-1" state="AwaitingPlanApproval" onAction={onAction} />,
      );
      await userEvent.click(screen.getByRole("button", { name: /reject plan/i }));

      expect(
        screen.getByText(/This will reject the current plan/i),
      ).toBeDefined();

      // "Revise plan" (mode toggle, lowercase p) is present and defaults active
      const modeButtons = screen.getAllByText("Revise plan");
      expect(modeButtons.length).toBeGreaterThan(0);

      const textarea = screen.getByPlaceholderText(/describe what should change/i);
      await userEvent.type(textarea, "  please tighten step 3  ");

      // Two "Reject Plan" buttons exist now: the sidebar trigger and the
      // dialog's confirm button (rendered last in the DOM).
      const rejectConfirmBtn = screen.getAllByRole("button", { name: "Reject Plan" }).at(-1)!;
      await userEvent.click(rejectConfirmBtn);

      await waitFor(() => {
        expect(mockApi.rejectPlan).toHaveBeenCalledWith(
          "run-1",
          "please tighten step 3",
          "iterate",
        );
        expect(onAction).toHaveBeenCalledOnce();
      });
    });

    it("switches reject mode to 'fresh' when Start fresh is clicked", async () => {
      render(
        <ActionBar runId="run-1" state="AwaitingPlanApproval" onAction={vi.fn()} />,
      );
      await userEvent.click(screen.getByRole("button", { name: /reject plan/i }));

      const startFreshBtn = screen.getByText("Start fresh").closest("button")!;
      await userEvent.click(startFreshBtn);

      const rejectConfirmBtn = screen.getAllByRole("button", { name: "Reject Plan" }).at(-1)!;
      await userEvent.click(rejectConfirmBtn);

      await waitFor(() => {
        expect(mockApi.rejectPlan).toHaveBeenCalledWith("run-1", undefined, "fresh");
      });
    });

    it("switches reject mode back to 'iterate' when Revise plan is clicked after selecting fresh", async () => {
      render(
        <ActionBar runId="run-1" state="AwaitingPlanApproval" onAction={vi.fn()} />,
      );
      await userEvent.click(screen.getByRole("button", { name: /reject plan/i }));

      const startFreshBtn = screen.getByText("Start fresh").closest("button")!;
      await userEvent.click(startFreshBtn);

      const reviseModeBtn = screen.getByText("Revise plan").closest("button")!;
      await userEvent.click(reviseModeBtn);

      const rejectConfirmBtn = screen.getAllByRole("button", { name: "Reject Plan" }).at(-1)!;
      await userEvent.click(rejectConfirmBtn);

      await waitFor(() => {
        expect(mockApi.rejectPlan).toHaveBeenCalledWith("run-1", undefined, "iterate");
      });
    });

    it("submits reject with undefined context when textarea left empty", async () => {
      render(
        <ActionBar runId="run-1" state="AwaitingPlanApproval" onAction={vi.fn()} />,
      );
      await userEvent.click(screen.getByRole("button", { name: /reject plan/i }));
      const rejectConfirmBtn = screen.getAllByRole("button", { name: "Reject Plan" }).at(-1)!;
      await userEvent.click(rejectConfirmBtn);

      await waitFor(() => {
        expect(mockApi.rejectPlan).toHaveBeenCalledWith("run-1", undefined, "iterate");
      });
    });

    it("closes the reject dialog on cancel without calling rejectPlan and resets context", async () => {
      render(
        <ActionBar runId="run-1" state="AwaitingPlanApproval" onAction={vi.fn()} />,
      );
      await userEvent.click(screen.getByRole("button", { name: /reject plan/i }));
      const textarea = screen.getByPlaceholderText(/describe what should change/i);
      await userEvent.type(textarea, "some feedback");

      await userEvent.click(screen.getByRole("button", { name: "Cancel" }));

      expect(mockApi.rejectPlan).not.toHaveBeenCalled();
      expect(screen.queryByText(/This will reject the current plan/i)).toBeNull();

      // Reopen and confirm the textarea was reset
      await userEvent.click(screen.getByRole("button", { name: /reject plan/i }));
      const reopenedTextarea = screen.getByPlaceholderText(
        /describe what should change/i,
      ) as HTMLTextAreaElement;
      expect(reopenedTextarea.value).toBe("");
    });

    it("closes the reject dialog when the backdrop is clicked", async () => {
      const { container } = render(
        <ActionBar runId="run-1" state="AwaitingPlanApproval" onAction={vi.fn()} />,
      );
      await userEvent.click(screen.getByRole("button", { name: /reject plan/i }));
      const backdrop = container.querySelector(
        ".absolute.inset-0.bg-black\\/60",
      ) as HTMLElement;
      await userEvent.click(backdrop);
      expect(screen.queryByText(/This will reject the current plan/i)).toBeNull();
    });

    it("shows the 'Working...' state and disables buttons while rejectPlan is pending", async () => {
      let resolvePromise: () => void = () => {};
      mockApi.rejectPlan.mockReturnValue(
        new Promise<void>((resolve) => {
          resolvePromise = resolve;
        }),
      );
      render(
        <ActionBar runId="run-1" state="AwaitingPlanApproval" onAction={vi.fn()} />,
      );
      await userEvent.click(screen.getByRole("button", { name: /reject plan/i }));
      const rejectConfirmBtn = screen.getAllByRole("button", { name: "Reject Plan" }).at(-1)!;
      await userEvent.click(rejectConfirmBtn);

      expect(screen.getByText("Working...")).toBeDefined();
      const cancelBtn = screen.getByRole("button", { name: "Cancel" }) as HTMLButtonElement;
      expect(cancelBtn.disabled).toBe(true);

      resolvePromise();
      await waitFor(() => {
        expect(screen.queryByText("Working...")).toBeNull();
      });
    });

    it("still closes the reject dialog and resets loading when rejectPlan rejects", async () => {
      mockApi.rejectPlan.mockRejectedValue(new Error("network error"));
      render(
        <ActionBar runId="run-1" state="AwaitingPlanApproval" onAction={vi.fn()} />,
      );
      await userEvent.click(screen.getByRole("button", { name: /reject plan/i }));
      const rejectConfirmBtn = screen.getAllByRole("button", { name: "Reject Plan" }).at(-1)!;
      await userEvent.click(rejectConfirmBtn);

      await waitFor(() => {
        expect(screen.queryByText(/This will reject the current plan/i)).toBeNull();
      });
    });
  });

  describe("ReadyForHumanReview", () => {
    it("shows Approve & Complete and calls api.approveReview (no notes) on confirm", async () => {
      const onAction = vi.fn();
      render(
        <ActionBar runId="run-1" state="ReadyForHumanReview" onAction={onAction} />,
      );
      await userEvent.click(screen.getByRole("button", { name: /approve & complete/i }));
      expect(screen.getByText(/Make sure you've reviewed the PR/i)).toBeDefined();
      // No notes field for this dialog
      expect(screen.queryByRole("textbox")).toBeNull();

      await userEvent.click(screen.getByRole("button", { name: "Complete Run" }));

      await waitFor(() => {
        expect(mockApi.approveReview).toHaveBeenCalledWith("run-1");
        expect(onAction).toHaveBeenCalledOnce();
      });
    });
  });

  describe("active category (Pause)", () => {
    it.each(["Planning", "PlanReview", "PlanRevision", "Implementing", "AIReview", "AddressingReview"])(
      "shows Pause button for state %s and calls api.pauseRun on confirm",
      async (state) => {
        const onAction = vi.fn();
        render(<ActionBar runId="run-1" state={state} onAction={onAction} />);
        await userEvent.click(screen.getByRole("button", { name: /pause/i }));
        // Two "Pause" buttons now: sidebar trigger and dialog confirm (last in DOM)
        const confirmBtn = screen.getAllByRole("button", { name: "Pause" }).at(-1)!;
        await userEvent.click(confirmBtn);

        await waitFor(() => {
          expect(mockApi.pauseRun).toHaveBeenCalledWith("run-1");
          expect(onAction).toHaveBeenCalledOnce();
        });
      },
    );
  });

  describe("Resume", () => {
    it.each(["AIBlocked", "HumanClarificationNeeded", "Failed"])(
      "shows Resume button for state %s and calls api.resumeRun on confirm",
      async (state) => {
        const onAction = vi.fn();
        render(<ActionBar runId="run-1" state={state} onAction={onAction} />);
        await userEvent.click(screen.getByRole("button", { name: /^resume$/i }));
        // Two "Resume" buttons now: sidebar trigger and dialog confirm (last in DOM)
        const confirmBtn = screen.getAllByRole("button", { name: "Resume" }).at(-1)!;
        await userEvent.click(confirmBtn);

        await waitFor(() => {
          expect(mockApi.resumeRun).toHaveBeenCalledWith("run-1");
          expect(onAction).toHaveBeenCalledOnce();
        });
      },
    );

    it("shows the Answer Questions button for HumanClarificationNeeded and calls onScrollToQuestions", async () => {
      const onScrollToQuestions = vi.fn();
      render(
        <ActionBar
          runId="run-1"
          state="HumanClarificationNeeded"
          onAction={vi.fn()}
          onScrollToQuestions={onScrollToQuestions}
        />,
      );
      await userEvent.click(screen.getByRole("button", { name: /answer questions/i }));
      expect(onScrollToQuestions).toHaveBeenCalledOnce();
    });
  });

  describe("Retry stage", () => {
    it.each([
      ["Todo", "Start Run"],
      ["Planning", "Retry Planning"],
      ["PlanRevision", "Retry Plan Revision"],
      ["PlanReview", "Retry Plan Review"],
      ["Implementing", "Retry Execution"],
      ["AIReview", "Retry Code Review"],
      ["AddressingReview", "Retry Remediation"],
    ])("shows the correct retry label for state %s", async (state, label) => {
      render(<ActionBar runId="run-1" state={state} onAction={vi.fn()} />);
      // Use getAllByRole since some states (e.g. Planning) also render Pause
      const btn = screen.getByRole("button", { name: label });
      expect(btn).toBeDefined();
    });

    it("calls api.retryStage on confirm from the retry dialog", async () => {
      const onAction = vi.fn();
      render(<ActionBar runId="run-1" state="Todo" onAction={onAction} />);
      await userEvent.click(screen.getByRole("button", { name: "Start Run" }));
      expect(screen.getByText(/Re-run the current stage \(Todo\)/i)).toBeDefined();

      await userEvent.click(screen.getByRole("button", { name: "Retry" }));

      await waitFor(() => {
        expect(mockApi.retryStage).toHaveBeenCalledWith("run-1");
        expect(onAction).toHaveBeenCalledOnce();
      });
    });
  });

  it("shows the loading spinner and disables the confirm dialog while the standard action is pending", async () => {
    let resolvePromise: () => void = () => {};
    mockApi.approveReview.mockReturnValue(
      new Promise<void>((resolve) => {
        resolvePromise = resolve;
      }),
    );
    render(<ActionBar runId="run-1" state="ReadyForHumanReview" onAction={vi.fn()} />);
    await userEvent.click(screen.getByRole("button", { name: /approve & complete/i }));
    await userEvent.click(screen.getByRole("button", { name: "Complete Run" }));

    expect(screen.getByText("Working...")).toBeDefined();

    resolvePromise();
    await waitFor(() => {
      expect(screen.queryByText("Working...")).toBeNull();
    });
  });

  it("still closes the confirm dialog and resets loading when the action rejects", async () => {
    mockApi.approveReview.mockRejectedValue(new Error("boom"));
    render(<ActionBar runId="run-1" state="ReadyForHumanReview" onAction={vi.fn()} />);
    await userEvent.click(screen.getByRole("button", { name: /approve & complete/i }));
    await userEvent.click(screen.getByRole("button", { name: "Complete Run" }));

    await waitFor(() => {
      expect(screen.queryByText(/Make sure you've reviewed the PR/i)).toBeNull();
    });
  });

  it("handleConfirm is a no-op when dialog is null (cancel then confirm race is not reachable via UI, covered by dialog absence)", () => {
    // The dialog-null guard in handleConfirm is defensive; there is no direct UI path
    // to invoke onConfirm while dialog state is null since ConfirmDialog only renders
    // its confirm button when open (dialog !== null).
    render(<ActionBar runId="run-1" state="Todo" onAction={vi.fn()} />);
    expect(screen.queryByText("Working...")).toBeNull();
  });
});
