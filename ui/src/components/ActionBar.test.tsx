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
    for (const key of Object.keys(mockApi) as Array<keyof typeof mockApi>) {
      mockApi[key].mockResolvedValue(undefined);
    }
  });

  it("renders null when no action applies to the current state", () => {
    const onAction = vi.fn();
    const { container } = render(
      <ActionBar runId={RUN_ID} state="Done" onAction={onAction} hasOptionalQuestions={false} />,
    );
    expect(container.firstChild).toBeNull();
  });

  describe("AwaitingPlanApproval", () => {
    it("shows Approve Plan, Reject Plan, Re-review Plan, Revise Plan but not the optional-questions button by default", () => {
      render(
        <ActionBar runId={RUN_ID} state="AwaitingPlanApproval" onAction={vi.fn()} />,
      );
      expect(screen.getByRole("button", { name: "Approve Plan" })).toBeDefined();
      expect(screen.getAllByRole("button", { name: "Reject Plan" }).length).toBe(1);
      expect(screen.getByRole("button", { name: "Re-review Plan" })).toBeDefined();
      expect(screen.getByRole("button", { name: "Revise Plan" })).toBeDefined();
      expect(screen.queryByRole("button", { name: "Answer Optional Questions" })).toBeNull();
    });

    it("shows Answer Optional Questions when hasOptionalQuestions is true", () => {
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
      const btn = screen.getByRole("button", { name: "Answer Optional Questions" });
      expect(btn).toBeDefined();
    });

    it("clicking Approve Plan opens ConfirmDialog; confirming calls api.approvePlan then onAction", async () => {
      const user = userEvent.setup();
      const onAction = vi.fn();
      render(<ActionBar runId={RUN_ID} state="AwaitingPlanApproval" onAction={onAction} />);

      await user.click(screen.getByRole("button", { name: "Approve Plan" }));
      expect(screen.getByRole("heading", { name: "Approve Plan" })).toBeDefined();

      const textarea = screen.getByPlaceholderText(/extra context/i);
      await user.type(textarea, "watch the edge cases");

      await user.click(screen.getByRole("button", { name: "Approve & Start" }));

      await waitFor(() => {
        expect(mockApi.approvePlan).toHaveBeenCalledWith(RUN_ID, "watch the edge cases");
      });
      expect(onAction).toHaveBeenCalledTimes(1);
      // dialog should be closed afterward
      expect(screen.queryByRole("heading", { name: "Approve Plan" })).toBeNull();
    });

    it("clicking Reject Plan opens the custom reject dialog; toggling mode, typing feedback and confirming calls api.rejectPlan then onAction", async () => {
      const user = userEvent.setup();
      const onAction = vi.fn();
      render(<ActionBar runId={RUN_ID} state="AwaitingPlanApproval" onAction={onAction} />);

      await user.click(screen.getByRole("button", { name: "Reject Plan" }));
      expect(screen.getByRole("heading", { name: "Reject Plan" })).toBeDefined();

      // toggle to "fresh" mode
      await user.click(screen.getByRole("button", { name: /start fresh/i }));

      const textarea = screen.getByPlaceholderText(/describe what should change/i);
      await user.type(textarea, "  please tighten scope  ");

      // there are now two buttons literally named "Reject Plan": the original
      // trigger and the dialog's confirm button (last in DOM order).
      const rejectButtons = screen.getAllByRole("button", { name: "Reject Plan" });
      await user.click(rejectButtons[rejectButtons.length - 1]);

      await waitFor(() => {
        expect(mockApi.rejectPlan).toHaveBeenCalledWith(RUN_ID, "please tighten scope", "fresh");
      });
      expect(onAction).toHaveBeenCalledTimes(1);
      expect(screen.queryByRole("heading", { name: "Reject Plan" })).toBeNull();
    });

    it("Reject Plan Cancel resets the textarea and mode without calling the API", async () => {
      const user = userEvent.setup();
      const onAction = vi.fn();
      render(<ActionBar runId={RUN_ID} state="AwaitingPlanApproval" onAction={onAction} />);

      await user.click(screen.getByRole("button", { name: "Reject Plan" }));
      await user.click(screen.getByRole("button", { name: /start fresh/i }));
      const textarea = screen.getByPlaceholderText(/describe what should change/i);
      await user.type(textarea, "some feedback");

      await user.click(screen.getByRole("button", { name: "Cancel" }));

      expect(mockApi.rejectPlan).not.toHaveBeenCalled();
      expect(onAction).not.toHaveBeenCalled();
      expect(screen.queryByRole("heading", { name: "Reject Plan" })).toBeNull();

      // reopen and verify state was reset back to defaults
      await user.click(screen.getByRole("button", { name: "Reject Plan" }));
      const reopenedTextarea = screen.getByPlaceholderText(
        /describe what should change/i,
      ) as HTMLTextAreaElement;
      expect(reopenedTextarea.value).toBe("");
    });

    it("ConfirmDialog Cancel closes it without calling the API", async () => {
      const user = userEvent.setup();
      const onAction = vi.fn();
      render(<ActionBar runId={RUN_ID} state="AwaitingPlanApproval" onAction={onAction} />);

      await user.click(screen.getByRole("button", { name: "Approve Plan" }));
      expect(screen.getByRole("heading", { name: "Approve Plan" })).toBeDefined();

      await user.click(screen.getByRole("button", { name: "Cancel" }));

      expect(screen.queryByRole("heading", { name: "Approve Plan" })).toBeNull();
      expect(mockApi.approvePlan).not.toHaveBeenCalled();
      expect(onAction).not.toHaveBeenCalled();
    });

    it("Reject Plan mode toggles back to 'iterate' and sends that mode on confirm", async () => {
      const user = userEvent.setup();
      const onAction = vi.fn();
      render(<ActionBar runId={RUN_ID} state="AwaitingPlanApproval" onAction={onAction} />);

      await user.click(screen.getByRole("button", { name: "Reject Plan" }));
      // switch to fresh, then explicitly back to iterate
      await user.click(screen.getByRole("button", { name: /start fresh/i }));
      await user.click(screen.getByRole("button", { name: /iterate with full context/i }));

      const rejectButtons = screen.getAllByRole("button", { name: "Reject Plan" });
      await user.click(rejectButtons[rejectButtons.length - 1]);

      await waitFor(() => {
        expect(mockApi.rejectPlan).toHaveBeenCalledWith(RUN_ID, undefined, "iterate");
      });
      expect(onAction).toHaveBeenCalledTimes(1);
    });

    it("Re-review Plan opens its own ConfirmDialog with notes and calls api.reReviewPlan with the note", async () => {
      const user = userEvent.setup();
      const onAction = vi.fn();
      render(<ActionBar runId={RUN_ID} state="AwaitingPlanApproval" onAction={onAction} />);

      await user.click(screen.getByRole("button", { name: "Re-review Plan" }));
      expect(screen.getByRole("heading", { name: "Re-review Plan" })).toBeDefined();

      const textarea = screen.getByPlaceholderText(/focus on the test plan/i);
      await user.type(textarea, "check risks");
      await user.click(screen.getByRole("button", { name: "Re-review" }));

      await waitFor(() => {
        expect(mockApi.reReviewPlan).toHaveBeenCalledWith(RUN_ID, "check risks");
      });
      expect(onAction).toHaveBeenCalledTimes(1);
    });

    it("Revise Plan opens its own ConfirmDialog with notes and calls api.revisePlan with the note", async () => {
      const user = userEvent.setup();
      const onAction = vi.fn();
      render(<ActionBar runId={RUN_ID} state="AwaitingPlanApproval" onAction={onAction} />);

      await user.click(screen.getByRole("button", { name: "Revise Plan" }));
      expect(screen.getByRole("heading", { name: "Revise Plan" })).toBeDefined();

      const textarea = screen.getByPlaceholderText(/tighten the rollout step/i);
      await user.type(textarea, "expand tests");
      await user.click(screen.getByRole("button", { name: "Revise" }));

      await waitFor(() => {
        expect(mockApi.revisePlan).toHaveBeenCalledWith(RUN_ID, "expand tests");
      });
      expect(onAction).toHaveBeenCalledTimes(1);
    });
  });

  it("ReadyForHumanReview shows Approve & Complete calling api.approveReview then onAction", async () => {
    const user = userEvent.setup();
    const onAction = vi.fn();
    render(<ActionBar runId={RUN_ID} state="ReadyForHumanReview" onAction={onAction} />);

    await user.click(screen.getByRole("button", { name: "Approve & Complete" }));
    expect(screen.getByRole("heading", { name: "Approve & Complete" })).toBeDefined();

    await user.click(screen.getByRole("button", { name: "Complete Run" }));

    await waitFor(() => {
      expect(mockApi.approveReview).toHaveBeenCalledWith(RUN_ID);
    });
    expect(onAction).toHaveBeenCalledTimes(1);
  });

  it("an active-category state (Implementing) shows Pause calling api.pauseRun then onAction", async () => {
    const user = userEvent.setup();
    const onAction = vi.fn();
    render(<ActionBar runId={RUN_ID} state="Implementing" onAction={onAction} />);

    await user.click(screen.getByRole("button", { name: "Pause" }));
    expect(screen.getByRole("heading", { name: "Pause Run" })).toBeDefined();

    // Two buttons are now labeled "Pause": the trigger and the dialog confirm.
    const pauseButtons = screen.getAllByRole("button", { name: "Pause" });
    await user.click(pauseButtons[pauseButtons.length - 1]);

    await waitFor(() => {
      expect(mockApi.pauseRun).toHaveBeenCalledWith(RUN_ID);
    });
    expect(onAction).toHaveBeenCalledTimes(1);
  });

  it.each(["AIBlocked", "HumanClarificationNeeded", "Failed"])(
    "%s shows Resume calling api.resumeRun then onAction",
    async (state) => {
      const user = userEvent.setup();
      const onAction = vi.fn();
      render(<ActionBar runId={RUN_ID} state={state} onAction={onAction} />);

      await user.click(screen.getByRole("button", { name: "Resume" }));
      expect(screen.getByRole("heading", { name: "Resume Run" })).toBeDefined();

      const resumeButtons = screen.getAllByRole("button", { name: "Resume" });
      await user.click(resumeButtons[resumeButtons.length - 1]);

      await waitFor(() => {
        expect(mockApi.resumeRun).toHaveBeenCalledWith(RUN_ID);
      });
      expect(onAction).toHaveBeenCalledTimes(1);
    },
  );

  it("a state in RETRY_LABELS (Planning) shows the mapped retry label and calls api.retryStage then onAction", async () => {
    const user = userEvent.setup();
    const onAction = vi.fn();
    render(<ActionBar runId={RUN_ID} state="Planning" onAction={onAction} />);

    const retryTrigger = screen.getByRole("button", { name: "Retry Planning" });
    expect(retryTrigger).toBeDefined();
    await user.click(retryTrigger);

    expect(screen.getByRole("heading", { name: "Retry Planning" })).toBeDefined();
    await user.click(screen.getByRole("button", { name: "Retry" }));

    await waitFor(() => {
      expect(mockApi.retryStage).toHaveBeenCalledWith(RUN_ID);
    });
    expect(onAction).toHaveBeenCalledTimes(1);
  });

  it("HumanClarificationNeeded shows Answer Questions which calls onScrollToQuestions directly with no dialog or API call", async () => {
    const user = userEvent.setup();
    const onAction = vi.fn();
    const onScrollToQuestions = vi.fn();
    render(
      <ActionBar
        runId={RUN_ID}
        state="HumanClarificationNeeded"
        onAction={onAction}
        onScrollToQuestions={onScrollToQuestions}
      />,
    );

    await user.click(screen.getByRole("button", { name: "Answer Questions" }));

    expect(onScrollToQuestions).toHaveBeenCalledTimes(1);
    expect(onAction).not.toHaveBeenCalled();
    expect(mockApi.approvePlan).not.toHaveBeenCalled();
    expect(mockApi.resumeRun).not.toHaveBeenCalled();
    // no dialog should have appeared
    expect(screen.queryByRole("heading")).toBeNull();
  });

  it("shows loading UI (disabled buttons + spinner) while the ConfirmDialog action is pending, then clears it", async () => {
    const user = userEvent.setup();
    let resolveFn!: () => void;
    const pending = new Promise<void>((res) => {
      resolveFn = res;
    });
    mockApi.approvePlan.mockReturnValue(pending);

    render(<ActionBar runId={RUN_ID} state="AwaitingPlanApproval" onAction={vi.fn()} />);

    await user.click(screen.getByRole("button", { name: "Approve Plan" }));
    await user.click(screen.getByRole("button", { name: "Approve & Start" }));

    // Buttons in the dialog become disabled and show the spinner label
    expect(screen.getByText(/working/i)).toBeDefined();
    const cancelBtn = screen.getByRole("button", { name: "Cancel" }) as HTMLButtonElement;
    expect(cancelBtn.disabled).toBe(true);

    resolveFn();

    await waitFor(() => {
      expect(screen.queryByText(/working/i)).toBeNull();
    });
  });

  it("shows loading UI in the custom reject dialog while pending", async () => {
    const user = userEvent.setup();
    let resolveFn!: () => void;
    const pending = new Promise<void>((res) => {
      resolveFn = res;
    });
    mockApi.rejectPlan.mockReturnValue(pending);

    render(<ActionBar runId={RUN_ID} state="AwaitingPlanApproval" onAction={vi.fn()} />);

    await user.click(screen.getByRole("button", { name: "Reject Plan" }));
    const rejectButtons = screen.getAllByRole("button", { name: "Reject Plan" });
    await user.click(rejectButtons[rejectButtons.length - 1]);

    expect(screen.getByText(/working/i)).toBeDefined();
    const cancelBtn = screen.getByRole("button", { name: "Cancel" }) as HTMLButtonElement;
    expect(cancelBtn.disabled).toBe(true);

    resolveFn();

    await waitFor(() => {
      expect(screen.queryByText(/working/i)).toBeNull();
    });
  });

  it("an API call that rejects still closes the ConfirmDialog and resets loading", async () => {
    const user = userEvent.setup();
    const onAction = vi.fn();
    mockApi.approvePlan.mockRejectedValue(new Error("boom"));

    render(<ActionBar runId={RUN_ID} state="AwaitingPlanApproval" onAction={onAction} />);

    await user.click(screen.getByRole("button", { name: "Approve Plan" }));
    await user.click(screen.getByRole("button", { name: "Approve & Start" }));

    await waitFor(() => {
      expect(screen.queryByRole("heading", { name: "Approve Plan" })).toBeNull();
    });
    expect(onAction).not.toHaveBeenCalled();
  });

  it("a rejected rejectPlan call still closes the custom reject dialog and resets loading", async () => {
    const user = userEvent.setup();
    const onAction = vi.fn();
    mockApi.rejectPlan.mockRejectedValue(new Error("boom"));

    render(<ActionBar runId={RUN_ID} state="AwaitingPlanApproval" onAction={onAction} />);

    await user.click(screen.getByRole("button", { name: "Reject Plan" }));
    const rejectButtons = screen.getAllByRole("button", { name: "Reject Plan" });
    await user.click(rejectButtons[rejectButtons.length - 1]);

    await waitFor(() => {
      expect(screen.queryByRole("heading", { name: "Reject Plan" })).toBeNull();
    });
    expect(onAction).not.toHaveBeenCalled();
  });
});
