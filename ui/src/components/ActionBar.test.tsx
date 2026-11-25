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
      fn.mockResolvedValue({ ok: true });
    }
  });

  it("renders nothing for a state with no applicable actions", () => {
    const { container } = render(
      <ActionBar runId="run-1" state="Done" onAction={vi.fn()} />,
    );
    expect(container.firstChild).toBeNull();
  });

  describe("AwaitingPlanApproval", () => {
    it("shows Approve/Reject/Re-review/Revise buttons but no optional-questions button by default", () => {
      render(<ActionBar runId="run-1" state="AwaitingPlanApproval" onAction={vi.fn()} />);

      expect(screen.getByRole("button", { name: "Approve Plan" })).toBeDefined();
      expect(screen.getByRole("button", { name: "Reject Plan" })).toBeDefined();
      expect(screen.getByRole("button", { name: "Re-review Plan" })).toBeDefined();
      expect(screen.getByRole("button", { name: "Revise Plan" })).toBeDefined();
      expect(screen.queryByRole("button", { name: /answer optional questions/i })).toBeNull();
    });

    it("shows the Answer Optional Questions button when hasOptionalQuestions is true", async () => {
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
      await userEvent.click(btn);
      expect(onScrollToQuestions).toHaveBeenCalledOnce();
    });

    it("approves the plan with a note and calls onAction", async () => {
      const onAction = vi.fn();
      render(<ActionBar runId="run-1" state="AwaitingPlanApproval" onAction={onAction} />);

      await userEvent.click(screen.getByRole("button", { name: "Approve Plan" }));

      // Confirmation dialog appears with notes field
      const textarea = await screen.findByRole("textbox");
      await userEvent.type(textarea, "watch for edge cases");

      await userEvent.click(screen.getByRole("button", { name: "Approve & Start" }));

      await waitFor(() => {
        expect(mockApi.approvePlan).toHaveBeenCalledWith("run-1", "watch for edge cases");
        expect(onAction).toHaveBeenCalledOnce();
      });

      // Dialog closes after confirming
      expect(screen.queryByRole("textbox")).toBeNull();
    });

    it("cancelling the Approve Plan dialog does not call the API", async () => {
      render(<ActionBar runId="run-1" state="AwaitingPlanApproval" onAction={vi.fn()} />);

      await userEvent.click(screen.getByRole("button", { name: "Approve Plan" }));
      await screen.findByRole("textbox");

      await userEvent.click(screen.getByRole("button", { name: "Cancel" }));

      expect(mockApi.approvePlan).not.toHaveBeenCalled();
      expect(screen.queryByRole("textbox")).toBeNull();
    });

    it("re-reviews the plan via its own confirmation dialog", async () => {
      const onAction = vi.fn();
      render(<ActionBar runId="run-1" state="AwaitingPlanApproval" onAction={onAction} />);

      await userEvent.click(screen.getByRole("button", { name: "Re-review Plan" }));
      expect(screen.getByText(/run the plan reviewer again/i)).toBeDefined();

      await userEvent.click(screen.getByRole("button", { name: "Re-review" }));

      await waitFor(() => {
        expect(mockApi.reReviewPlan).toHaveBeenCalledWith("run-1", undefined);
        expect(onAction).toHaveBeenCalledOnce();
      });
    });

    it("revises the plan via its own confirmation dialog", async () => {
      const onAction = vi.fn();
      render(<ActionBar runId="run-1" state="AwaitingPlanApproval" onAction={onAction} />);

      await userEvent.click(screen.getByRole("button", { name: "Revise Plan" }));
      await userEvent.click(screen.getByRole("button", { name: "Revise" }));

      await waitFor(() => {
        expect(mockApi.revisePlan).toHaveBeenCalledWith("run-1", undefined);
        expect(onAction).toHaveBeenCalledOnce();
      });
    });

    it("opens the reject dialog, switches to fresh mode, and rejects with feedback", async () => {
      const onAction = vi.fn();
      render(<ActionBar runId="run-1" state="AwaitingPlanApproval" onAction={onAction} />);

      await userEvent.click(screen.getByRole("button", { name: "Reject Plan" }));
      expect(screen.getByText(/reject the current plan/i)).toBeDefined();

      await userEvent.click(screen.getByText("Start fresh"));

      const textarea = screen.getByPlaceholderText(/describe what should change/i);
      await userEvent.type(textarea, "please re-scope the DB migration");

      const confirmButtons = screen.getAllByRole("button", { name: "Reject Plan" });
      await userEvent.click(confirmButtons[confirmButtons.length - 1]);

      await waitFor(() => {
        expect(mockApi.rejectPlan).toHaveBeenCalledWith(
          "run-1",
          "please re-scope the DB migration",
          "fresh",
        );
        expect(onAction).toHaveBeenCalledOnce();
      });
    });

    it("rejects with default iterate mode and no feedback when left blank", async () => {
      render(<ActionBar runId="run-1" state="AwaitingPlanApproval" onAction={vi.fn()} />);

      await userEvent.click(screen.getByRole("button", { name: "Reject Plan" }));
      const confirmButtons = screen.getAllByRole("button", { name: "Reject Plan" });
      await userEvent.click(confirmButtons[confirmButtons.length - 1]);

      await waitFor(() => {
        expect(mockApi.rejectPlan).toHaveBeenCalledWith("run-1", undefined, "iterate");
      });
    });

    it("resets reject dialog state (mode + feedback) when cancelled and reopened", async () => {
      render(<ActionBar runId="run-1" state="AwaitingPlanApproval" onAction={vi.fn()} />);

      await userEvent.click(screen.getByRole("button", { name: "Reject Plan" }));
      await userEvent.click(screen.getByText("Start fresh"));
      const textarea = screen.getByPlaceholderText(/describe what should change/i);
      await userEvent.type(textarea, "some feedback");

      await userEvent.click(screen.getByRole("button", { name: "Cancel" }));
      expect(screen.queryByPlaceholderText(/describe what should change/i)).toBeNull();

      await userEvent.click(screen.getByRole("button", { name: "Reject Plan" }));
      const reopenedTextarea = screen.getByPlaceholderText(
        /describe what should change/i,
      ) as HTMLTextAreaElement;
      expect(reopenedTextarea.value).toBe("");
      // "Revise plan" (iterate) should be the active/default mode again.
      expect(screen.getByText("Revise plan").closest("button")?.className).toContain(
        "bg-accent",
      );
    });

    it("can switch back to iterate mode after selecting fresh", async () => {
      render(<ActionBar runId="run-1" state="AwaitingPlanApproval" onAction={vi.fn()} />);

      await userEvent.click(screen.getByRole("button", { name: "Reject Plan" }));
      await userEvent.click(screen.getByText("Start fresh"));
      expect(screen.getByText("Start fresh").closest("button")?.className).toContain(
        "bg-accent",
      );

      await userEvent.click(screen.getByText("Revise plan"));
      expect(screen.getByText("Revise plan").closest("button")?.className).toContain(
        "bg-accent",
      );
      expect(screen.getByText("Start fresh").closest("button")?.className).not.toContain(
        "bg-accent",
      );
    });
  });

  it("ReadyForHumanReview: approves & completes the run (no notes field)", async () => {
    const onAction = vi.fn();
    render(<ActionBar runId="run-1" state="ReadyForHumanReview" onAction={onAction} />);

    await userEvent.click(screen.getByRole("button", { name: "Approve & Complete" }));
    expect(screen.queryByRole("textbox")).toBeNull();

    await userEvent.click(screen.getByRole("button", { name: "Complete Run" }));

    await waitFor(() => {
      expect(mockApi.approveReview).toHaveBeenCalledWith("run-1");
      expect(onAction).toHaveBeenCalledOnce();
    });
  });

  it("active states (e.g. Implementing) show a Pause button and a stage-specific Retry button", async () => {
    const onAction = vi.fn();
    render(<ActionBar runId="run-1" state="Implementing" onAction={onAction} />);

    expect(screen.getByRole("button", { name: "Retry Execution" })).toBeDefined();

    const pauseButtons = screen.getAllByRole("button", { name: "Pause" });
    await userEvent.click(pauseButtons[0]);

    const confirmPause = screen.getAllByRole("button", { name: "Pause" });
    await userEvent.click(confirmPause[confirmPause.length - 1]);

    await waitFor(() => {
      expect(mockApi.pauseRun).toHaveBeenCalledWith("run-1");
      expect(onAction).toHaveBeenCalledOnce();
    });
  });

  it("retries the current stage using the state-specific label", async () => {
    const onAction = vi.fn();
    render(<ActionBar runId="run-1" state="AIReview" onAction={onAction} />);

    await userEvent.click(screen.getByRole("button", { name: "Retry Code Review" }));
    expect(screen.getByText(/re-run the current stage \(AIReview\)/i)).toBeDefined();

    await userEvent.click(screen.getByRole("button", { name: "Retry" }));

    await waitFor(() => {
      expect(mockApi.retryStage).toHaveBeenCalledWith("run-1");
      expect(onAction).toHaveBeenCalledOnce();
    });
  });

  it("Todo state shows a 'Start Run' retry button", () => {
    render(<ActionBar runId="run-1" state="Todo" onAction={vi.fn()} />);
    expect(screen.getByRole("button", { name: "Start Run" })).toBeDefined();
  });

  it("blocked/needs-clarification/failed states show a Resume button that resets the run", async () => {
    const onAction = vi.fn();
    render(<ActionBar runId="run-1" state="AIBlocked" onAction={onAction} />);

    const resumeButtons = screen.getAllByRole("button", { name: "Resume" });
    await userEvent.click(resumeButtons[0]);
    expect(screen.getByText(/reset the run back to the start/i)).toBeDefined();

    const confirmResume = screen.getAllByRole("button", { name: "Resume" });
    await userEvent.click(confirmResume[confirmResume.length - 1]);

    await waitFor(() => {
      expect(mockApi.resumeRun).toHaveBeenCalledWith("run-1");
      expect(onAction).toHaveBeenCalledOnce();
    });
  });

  it("HumanClarificationNeeded shows an Answer Questions button that scrolls to questions", async () => {
    const onScrollToQuestions = vi.fn();
    render(
      <ActionBar
        runId="run-1"
        state="HumanClarificationNeeded"
        onAction={vi.fn()}
        onScrollToQuestions={onScrollToQuestions}
      />,
    );

    await userEvent.click(screen.getByRole("button", { name: "Answer Questions" }));
    expect(onScrollToQuestions).toHaveBeenCalledOnce();

    // Also a Resume button since HumanClarificationNeeded is in the resume set.
    expect(screen.getAllByRole("button", { name: "Resume" }).length).toBeGreaterThan(0);
  });

  it("Failed state shows only a Resume button (no retry label mapping)", () => {
    render(<ActionBar runId="run-1" state="Failed" onAction={vi.fn()} />);
    expect(screen.getByRole("button", { name: "Resume" })).toBeDefined();
    expect(screen.queryByText(/^Retry/)).toBeNull();
  });

  it("shows a loading indicator and disables buttons while an action is in flight, then clears on completion", async () => {
    let resolveAction: (v: unknown) => void = () => {};
    mockApi.pauseRun.mockReturnValue(
      new Promise((resolve) => {
        resolveAction = resolve;
      }),
    );

    render(<ActionBar runId="run-1" state="Implementing" onAction={vi.fn()} />);

    const pauseButtons = screen.getAllByRole("button", { name: "Pause" });
    await userEvent.click(pauseButtons[0]);

    const confirmPause = screen.getAllByRole("button", { name: "Pause" });
    await userEvent.click(confirmPause[confirmPause.length - 1]);

    expect(screen.getByText("Working...")).toBeDefined();
    expect((screen.getByRole("button", { name: "Cancel" }) as HTMLButtonElement).disabled).toBe(
      true,
    );

    resolveAction({ ok: true });
    await waitFor(() => {
      expect(screen.queryByText("Working...")).toBeNull();
    });
  });

  it("closes the confirmation dialog even when the action rejects", async () => {
    mockApi.pauseRun.mockRejectedValue(new Error("network error"));
    const onAction = vi.fn();

    render(<ActionBar runId="run-1" state="Implementing" onAction={onAction} />);

    const pauseButtons = screen.getAllByRole("button", { name: "Pause" });
    await userEvent.click(pauseButtons[0]);
    const confirmPause = screen.getAllByRole("button", { name: "Pause" });
    await userEvent.click(confirmPause[confirmPause.length - 1]);

    await waitFor(() => {
      expect(screen.queryByText("Working...")).toBeNull();
    });
    // Dialog is dismissed and onAction is not called since the promise rejected.
    expect(screen.getAllByRole("button", { name: "Pause" })).toHaveLength(1);
    expect(onAction).not.toHaveBeenCalled();
  });

  it("closes the reject dialog even when rejectPlan rejects", async () => {
    mockApi.rejectPlan.mockRejectedValue(new Error("boom"));

    render(<ActionBar runId="run-1" state="AwaitingPlanApproval" onAction={vi.fn()} />);

    await userEvent.click(screen.getByRole("button", { name: "Reject Plan" }));
    const confirmButtons = screen.getAllByRole("button", { name: "Reject Plan" });
    await userEvent.click(confirmButtons[confirmButtons.length - 1]);

    await waitFor(() => {
      expect(screen.queryByPlaceholderText(/describe what should change/i)).toBeNull();
    });
  });

  it("clicking the backdrop of the reject dialog cancels it", async () => {
    const { container } = render(
      <ActionBar runId="run-1" state="AwaitingPlanApproval" onAction={vi.fn()} />,
    );

    await userEvent.click(screen.getByRole("button", { name: "Reject Plan" }));
    expect(screen.getByPlaceholderText(/describe what should change/i)).toBeDefined();

    const backdrop = container.querySelector(".fixed.inset-0 .absolute.inset-0") as HTMLElement;
    await userEvent.click(backdrop);

    expect(screen.queryByPlaceholderText(/describe what should change/i)).toBeNull();
  });
});
