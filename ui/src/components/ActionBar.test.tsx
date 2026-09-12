import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, act } from "@testing-library/react";
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

const RUN_ID = "run-123";

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
    Object.values(mockApi).forEach((fn) => fn.mockResolvedValue(undefined));
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
      expect(screen.getByRole("button", { name: /^Approve Plan$/ })).toBeDefined();
      expect(screen.getByRole("button", { name: /^Reject Plan$/ })).toBeDefined();
      expect(screen.getByRole("button", { name: /Re-review Plan/ })).toBeDefined();
      expect(screen.getByRole("button", { name: /Revise Plan/ })).toBeDefined();
      expect(screen.queryByRole("button", { name: /Answer Optional Questions/ })).toBeNull();
    });

    it("shows Answer Optional Questions button when hasOptionalQuestions is true and calls onScrollToQuestions", async () => {
      const onScroll = vi.fn();
      render(
        <ActionBar
          runId={RUN_ID}
          state="AwaitingPlanApproval"
          onAction={vi.fn()}
          hasOptionalQuestions
          onScrollToQuestions={onScroll}
        />,
      );
      const btn = screen.getByRole("button", { name: /Answer Optional Questions/ });
      await userEvent.click(btn);
      expect(onScroll).toHaveBeenCalledTimes(1);
    });

    it("Approve Plan: opens dialog, submits note, calls api.approvePlan with trimmed note and triggers onAction", async () => {
      const onAction = vi.fn();
      render(<ActionBar runId={RUN_ID} state="AwaitingPlanApproval" onAction={onAction} />);

      await userEvent.click(screen.getByRole("button", { name: /^Approve Plan$/ }));
      expect(screen.getAllByText("Approve Plan").length).toBeGreaterThan(0);
      expect(
        screen.getByText(/This will approve the current plan and start implementation/),
      ).toBeDefined();

      const textarea = screen.getByPlaceholderText(/extra context, edge cases/);
      await userEvent.type(textarea, "  watch the auth flow  ");
      await userEvent.click(screen.getByRole("button", { name: /Approve & Start/ }));

      await waitFor(() => {
        expect(mockApi.approvePlan).toHaveBeenCalledWith(RUN_ID, "watch the auth flow");
      });
      expect(onAction).toHaveBeenCalledTimes(1);
      // dialog closed
      expect(screen.queryByRole("button", { name: /Approve & Start/ })).toBeNull();
    });

    it("Approve Plan: submits undefined note when textarea left empty", async () => {
      render(<ActionBar runId={RUN_ID} state="AwaitingPlanApproval" onAction={vi.fn()} />);
      await userEvent.click(screen.getByRole("button", { name: /^Approve Plan$/ }));
      await userEvent.click(screen.getByRole("button", { name: /Approve & Start/ }));
      await waitFor(() => {
        expect(mockApi.approvePlan).toHaveBeenCalledWith(RUN_ID, undefined);
      });
    });

    it("Approve Plan: Cancel closes dialog without calling the API", async () => {
      render(<ActionBar runId={RUN_ID} state="AwaitingPlanApproval" onAction={vi.fn()} />);
      await userEvent.click(screen.getByRole("button", { name: /^Approve Plan$/ }));
      await userEvent.click(screen.getByRole("button", { name: /^Cancel$/ }));
      expect(mockApi.approvePlan).not.toHaveBeenCalled();
      expect(screen.queryByRole("button", { name: /Approve & Start/ })).toBeNull();
    });

    it("Approve Plan: shows Working... and disables buttons while pending, then closes on resolve", async () => {
      const { promise, resolve } = deferred<void>();
      mockApi.approvePlan.mockReturnValue(promise);
      render(<ActionBar runId={RUN_ID} state="AwaitingPlanApproval" onAction={vi.fn()} />);
      await userEvent.click(screen.getByRole("button", { name: /^Approve Plan$/ }));
      await userEvent.click(screen.getByRole("button", { name: /Approve & Start/ }));

      expect(screen.getByText(/Working.../)).toBeDefined();
      const cancelBtn = screen.getByRole("button", { name: /^Cancel$/ }) as HTMLButtonElement;
      expect(cancelBtn.disabled).toBe(true);

      await act(async () => {
        resolve(undefined);
      });

      await waitFor(() => {
        expect(screen.queryByText(/Working.../)).toBeNull();
      });
    });

    it("Approve Plan: swallows API errors, closes dialog, and does not call onAction", async () => {
      const onAction = vi.fn();
      mockApi.approvePlan.mockRejectedValue(new Error("boom"));
      render(<ActionBar runId={RUN_ID} state="AwaitingPlanApproval" onAction={onAction} />);
      await userEvent.click(screen.getByRole("button", { name: /^Approve Plan$/ }));
      await userEvent.click(screen.getByRole("button", { name: /Approve & Start/ }));

      await waitFor(() => {
        expect(screen.queryByRole("button", { name: /Approve & Start/ })).toBeNull();
      });
      expect(onAction).not.toHaveBeenCalled();
    });

    it("Reject Plan: iterate mode (default) submits feedback and mode 'iterate'", async () => {
      const onAction = vi.fn();
      render(<ActionBar runId={RUN_ID} state="AwaitingPlanApproval" onAction={onAction} />);
      await userEvent.click(screen.getByRole("button", { name: /^Reject Plan$/ }));

      expect(
        screen.getByText(/This will reject the current plan and send it back/),
      ).toBeDefined();

      const textarea = screen.getByPlaceholderText(/describe what should change/);
      await userEvent.type(textarea, "needs more detail");

      const dialogButtons = screen.getAllByRole("button", { name: /^Reject Plan$/ });
      // last "Reject Plan" button is the dialog's confirm button
      await userEvent.click(dialogButtons[dialogButtons.length - 1]);

      await waitFor(() => {
        expect(mockApi.rejectPlan).toHaveBeenCalledWith(RUN_ID, "needs more detail", "iterate");
      });
      expect(onAction).toHaveBeenCalledTimes(1);
    });

    it("Reject Plan: switching to 'Start fresh' mode submits mode 'fresh' and undefined feedback when empty", async () => {
      render(<ActionBar runId={RUN_ID} state="AwaitingPlanApproval" onAction={vi.fn()} />);
      await userEvent.click(screen.getByRole("button", { name: /^Reject Plan$/ }));
      await userEvent.click(screen.getByRole("button", { name: /Start fresh/ }));

      const dialogButtons = screen.getAllByRole("button", { name: /^Reject Plan$/ });
      await userEvent.click(dialogButtons[dialogButtons.length - 1]);

      await waitFor(() => {
        expect(mockApi.rejectPlan).toHaveBeenCalledWith(RUN_ID, undefined, "fresh");
      });
    });

    it("Reject Plan: Cancel closes the dialog and resets state without calling the API", async () => {
      render(<ActionBar runId={RUN_ID} state="AwaitingPlanApproval" onAction={vi.fn()} />);
      await userEvent.click(screen.getByRole("button", { name: /^Reject Plan$/ }));
      const textarea = screen.getByPlaceholderText(/describe what should change/);
      await userEvent.type(textarea, "some feedback");

      await userEvent.click(screen.getByRole("button", { name: /^Cancel$/ }));
      expect(mockApi.rejectPlan).not.toHaveBeenCalled();
      expect(screen.queryByPlaceholderText(/describe what should change/)).toBeNull();

      // re-open to confirm feedback/mode were reset
      await userEvent.click(screen.getByRole("button", { name: /^Reject Plan$/ }));
      expect(
        (screen.getByPlaceholderText(/describe what should change/) as HTMLTextAreaElement)
          .value,
      ).toBe("");
    });

    it("Reject Plan: shows Working... and disables Cancel/confirm while pending", async () => {
      const { promise, resolve } = deferred<void>();
      mockApi.rejectPlan.mockReturnValue(promise);
      render(<ActionBar runId={RUN_ID} state="AwaitingPlanApproval" onAction={vi.fn()} />);
      await userEvent.click(screen.getByRole("button", { name: /^Reject Plan$/ }));
      const dialogButtons = screen.getAllByRole("button", { name: /^Reject Plan$/ });
      await userEvent.click(dialogButtons[dialogButtons.length - 1]);

      expect(screen.getByText(/Working.../)).toBeDefined();
      const cancelBtn = screen.getByRole("button", { name: /^Cancel$/ }) as HTMLButtonElement;
      expect(cancelBtn.disabled).toBe(true);

      await act(async () => {
        resolve(undefined);
      });
      await waitFor(() => {
        expect(screen.queryByText(/Working.../)).toBeNull();
      });
    });

    it("Re-review Plan: opens dialog and calls api.reReviewPlan with note", async () => {
      const onAction = vi.fn();
      render(<ActionBar runId={RUN_ID} state="AwaitingPlanApproval" onAction={onAction} />);
      await userEvent.click(screen.getByRole("button", { name: /Re-review Plan/ }));
      expect(screen.getByText(/Run the plan reviewer again/)).toBeDefined();

      const textarea = screen.getByPlaceholderText(/focus on the test plan/);
      await userEvent.type(textarea, "check tests");
      await userEvent.click(screen.getByRole("button", { name: /^Re-review$/ }));

      await waitFor(() => {
        expect(mockApi.reReviewPlan).toHaveBeenCalledWith(RUN_ID, "check tests");
      });
      expect(onAction).toHaveBeenCalledTimes(1);
    });

    it("Revise Plan: opens dialog and calls api.revisePlan with note", async () => {
      const onAction = vi.fn();
      render(<ActionBar runId={RUN_ID} state="AwaitingPlanApproval" onAction={onAction} />);
      await userEvent.click(screen.getByRole("button", { name: /^Revise Plan$/ }));
      expect(screen.getByText(/automatically run the plan reviser/)).toBeDefined();

      const textarea = screen.getByPlaceholderText(/tighten the rollout step/);
      await userEvent.type(textarea, "tighten rollback");
      await userEvent.click(screen.getByRole("button", { name: /^Revise$/ }));

      await waitFor(() => {
        expect(mockApi.revisePlan).toHaveBeenCalledWith(RUN_ID, "tighten rollback");
      });
      expect(onAction).toHaveBeenCalledTimes(1);
    });
  });

  it("ReadyForHumanReview: Approve & Complete calls api.approveReview and onAction", async () => {
    const onAction = vi.fn();
    render(<ActionBar runId={RUN_ID} state="ReadyForHumanReview" onAction={onAction} />);
    const btn = screen.getByRole("button", { name: /Approve & Complete/ });
    await userEvent.click(btn);
    expect(screen.getByText(/mark the run as complete/)).toBeDefined();

    await userEvent.click(screen.getByRole("button", { name: /Complete Run/ }));
    await waitFor(() => {
      expect(mockApi.approveReview).toHaveBeenCalledWith(RUN_ID);
    });
    expect(onAction).toHaveBeenCalledTimes(1);
  });

  it("Implementing: shows both Pause and Retry Execution buttons", () => {
    render(<ActionBar runId={RUN_ID} state="Implementing" onAction={vi.fn()} />);
    expect(screen.getByRole("button", { name: /^Pause$/ })).toBeDefined();
    expect(screen.getByRole("button", { name: /Retry Execution/ })).toBeDefined();
  });

  it("Implementing: confirming the Pause dialog calls api.pauseRun(runId)", async () => {
    const onAction = vi.fn();
    render(<ActionBar runId={RUN_ID} state="Implementing" onAction={onAction} />);
    const pauseButtons = screen.getAllByRole("button", { name: /Pause/ });
    await userEvent.click(pauseButtons[0]);
    expect(screen.getByText(/This will pause the run/)).toBeDefined();
    const confirmButtons = screen.getAllByRole("button", { name: /Pause/ });
    await userEvent.click(confirmButtons[confirmButtons.length - 1]);
    await waitFor(() => {
      expect(mockApi.pauseRun).toHaveBeenCalledWith(RUN_ID);
    });
    expect(onAction).toHaveBeenCalledTimes(1);
  });

  it("Implementing: confirming the Retry Execution dialog calls api.retryStage(runId)", async () => {
    const onAction = vi.fn();
    render(<ActionBar runId={RUN_ID} state="Implementing" onAction={onAction} />);
    await userEvent.click(screen.getByRole("button", { name: /Retry Execution/ }));
    expect(
      screen.getByText(/Re-run the current stage \(Implementing\)/),
    ).toBeDefined();
    await userEvent.click(screen.getByRole("button", { name: /^Retry$/ }));
    await waitFor(() => {
      expect(mockApi.retryStage).toHaveBeenCalledWith(RUN_ID);
    });
    expect(onAction).toHaveBeenCalledTimes(1);
  });

  it("AIBlocked: shows only Resume (no Retry) and confirming calls api.resumeRun(runId)", async () => {
    const onAction = vi.fn();
    render(<ActionBar runId={RUN_ID} state="AIBlocked" onAction={onAction} />);
    expect(screen.queryByRole("button", { name: /^Pause$/ })).toBeNull();
    expect(screen.queryByRole("button", { name: /Retry/ })).toBeNull();

    await userEvent.click(screen.getByRole("button", { name: /^Resume$/ }));
    expect(screen.getByText(/reset the run back to the start/)).toBeDefined();
    const resumeButtons = screen.getAllByRole("button", { name: /^Resume$/ });
    await userEvent.click(resumeButtons[resumeButtons.length - 1]);

    await waitFor(() => {
      expect(mockApi.resumeRun).toHaveBeenCalledWith(RUN_ID);
    });
    expect(onAction).toHaveBeenCalledTimes(1);
  });

  it("HumanClarificationNeeded: shows Answer Questions (direct callback) and Resume (dialog)", async () => {
    const onScroll = vi.fn();
    render(
      <ActionBar
        runId={RUN_ID}
        state="HumanClarificationNeeded"
        onAction={vi.fn()}
        onScrollToQuestions={onScroll}
      />,
    );
    await userEvent.click(screen.getByRole("button", { name: /Answer Questions/ }));
    expect(onScroll).toHaveBeenCalledTimes(1);
    expect(mockApi.resumeRun).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: /^Resume$/ })).toBeDefined();
  });

  it("Failed: shows only Resume, no Pause/Retry buttons", () => {
    render(<ActionBar runId={RUN_ID} state="Failed" onAction={vi.fn()} />);
    expect(screen.getByRole("button", { name: /^Resume$/ })).toBeDefined();
    expect(screen.queryByRole("button", { name: /^Pause$/ })).toBeNull();
    expect(screen.queryByRole("button", { name: /Retry/ })).toBeNull();
  });

  it("Todo: shows 'Start Run' and confirming calls api.retryStage(runId)", async () => {
    const onAction = vi.fn();
    render(<ActionBar runId={RUN_ID} state="Todo" onAction={onAction} />);
    const startBtn = screen.getByRole("button", { name: /Start Run/ });
    await userEvent.click(startBtn);
    expect(screen.getAllByText("Start Run").length).toBeGreaterThan(0);
    await userEvent.click(screen.getByRole("button", { name: /^Retry$/ }));
    await waitFor(() => {
      expect(mockApi.retryStage).toHaveBeenCalledWith(RUN_ID);
    });
    expect(onAction).toHaveBeenCalledTimes(1);
  });
});
