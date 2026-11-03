import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ActionBar } from "./ActionBar.tsx";

vi.mock("@/api/client.ts", () => ({
  api: {
    approvePlan: vi.fn(),
    rejectPlan: vi.fn(),
    approveReview: vi.fn(),
    pauseRun: vi.fn(),
    resumeRun: vi.fn(),
    retryStage: vi.fn(),
    reReviewPlan: vi.fn(),
    revisePlan: vi.fn(),
  },
}));

import { api } from "@/api/client.ts";

const mockApi = api as unknown as {
  approvePlan: ReturnType<typeof vi.fn>;
  rejectPlan: ReturnType<typeof vi.fn>;
  approveReview: ReturnType<typeof vi.fn>;
  pauseRun: ReturnType<typeof vi.fn>;
  resumeRun: ReturnType<typeof vi.fn>;
  retryStage: ReturnType<typeof vi.fn>;
  reReviewPlan: ReturnType<typeof vi.fn>;
  revisePlan: ReturnType<typeof vi.fn>;
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

  describe("AwaitingPlanApproval state", () => {
    it("shows Approve Plan, Reject Plan, Re-review Plan, and Revise Plan buttons", () => {
      render(<ActionBar runId={RUN_ID} state="AwaitingPlanApproval" onAction={vi.fn()} />);
      expect(screen.getByRole("button", { name: /Approve Plan/i })).toBeDefined();
      expect(screen.getByRole("button", { name: /Reject Plan/i })).toBeDefined();
      expect(screen.getByRole("button", { name: /Re-review Plan/i })).toBeDefined();
      expect(screen.getByRole("button", { name: /Revise Plan/i })).toBeDefined();
    });

    it("shows the Answer Optional Questions button only when hasOptionalQuestions is true", () => {
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
      expect(screen.queryByRole("button", { name: /Answer Optional Questions/i })).toBeNull();

      rerender(
        <ActionBar
          runId={RUN_ID}
          state="AwaitingPlanApproval"
          onAction={vi.fn()}
          onScrollToQuestions={onScrollToQuestions}
          hasOptionalQuestions={true}
        />,
      );
      expect(screen.getByRole("button", { name: /Answer Optional Questions/i })).toBeDefined();
    });

    it("calls onScrollToQuestions when Answer Optional Questions is clicked", async () => {
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
      await userEvent.click(screen.getByRole("button", { name: /Answer Optional Questions/i }));
      expect(onScrollToQuestions).toHaveBeenCalledOnce();
    });

    it("opens the Approve Plan confirm dialog and calls api.approvePlan with the note on confirm", async () => {
      mockApi.approvePlan.mockResolvedValue({});
      const onAction = vi.fn();
      render(<ActionBar runId={RUN_ID} state="AwaitingPlanApproval" onAction={onAction} />);

      await userEvent.click(screen.getByRole("button", { name: /Approve Plan/i }));
      expect(screen.getByText("This will approve the current plan and start implementation. The AI agent will begin coding.")).toBeDefined();

      const textarea = screen.getByPlaceholderText(/extra context, edge cases/i);
      await userEvent.type(textarea, "watch out for X");

      await userEvent.click(screen.getByRole("button", { name: "Approve & Start" }));

      await waitFor(() => {
        expect(mockApi.approvePlan).toHaveBeenCalledWith(RUN_ID, "watch out for X");
        expect(onAction).toHaveBeenCalledOnce();
      });
      // Dialog closes after confirm
      expect(screen.queryByText(/This will approve the current plan/i)).toBeNull();
    });

    it("opens the custom Reject Plan dialog instead of the generic ConfirmDialog", async () => {
      render(<ActionBar runId={RUN_ID} state="AwaitingPlanApproval" onAction={vi.fn()} />);
      await userEvent.click(screen.getByRole("button", { name: /Reject Plan/i }));
      expect(
        screen.getByText("This will reject the current plan and send it back for re-planning."),
      ).toBeDefined();
      expect(screen.getByText("Revise plan")).toBeDefined();
      expect(screen.getByText("Start fresh")).toBeDefined();
    });

    it("rejects with default 'iterate' mode and trimmed feedback", async () => {
      mockApi.rejectPlan.mockResolvedValue({});
      const onAction = vi.fn();
      render(<ActionBar runId={RUN_ID} state="AwaitingPlanApproval" onAction={onAction} />);

      await userEvent.click(screen.getByRole("button", { name: /Reject Plan/i }));
      const textarea = screen.getByPlaceholderText(/describe what should change/i);
      await userEvent.type(textarea, "  needs more tests  ");

      // There are two "Reject Plan" labeled controls now: the dialog's submit
      // button text content is "Reject Plan" too — grab the last one (footer button).
      const rejectButtons = screen.getAllByRole("button", { name: /Reject Plan/i });
      await userEvent.click(rejectButtons[rejectButtons.length - 1]);

      await waitFor(() => {
        expect(mockApi.rejectPlan).toHaveBeenCalledWith(RUN_ID, "needs more tests", "iterate");
        expect(onAction).toHaveBeenCalledOnce();
      });
    });

    it("rejects with undefined feedback when textarea is left empty", async () => {
      mockApi.rejectPlan.mockResolvedValue({});
      render(<ActionBar runId={RUN_ID} state="AwaitingPlanApproval" onAction={vi.fn()} />);

      await userEvent.click(screen.getByRole("button", { name: /Reject Plan/i }));
      const rejectButtons = screen.getAllByRole("button", { name: /Reject Plan/i });
      await userEvent.click(rejectButtons[rejectButtons.length - 1]);

      await waitFor(() => {
        expect(mockApi.rejectPlan).toHaveBeenCalledWith(RUN_ID, undefined, "iterate");
      });
    });

    it("clicking 'Revise plan' keeps the default 'iterate' reject mode", async () => {
      mockApi.rejectPlan.mockResolvedValue({});
      render(<ActionBar runId={RUN_ID} state="AwaitingPlanApproval" onAction={vi.fn()} />);

      await userEvent.click(screen.getByRole("button", { name: /Reject Plan/i }));
      // Explicitly click the already-active "Revise plan" tab.
      await userEvent.click(screen.getByText("Revise plan"));

      const rejectButtons = screen.getAllByRole("button", { name: /Reject Plan/i });
      await userEvent.click(rejectButtons[rejectButtons.length - 1]);

      await waitFor(() => {
        expect(mockApi.rejectPlan).toHaveBeenCalledWith(RUN_ID, undefined, "iterate");
      });
    });

    it("switches reject mode to 'fresh' when 'Start fresh' is selected", async () => {
      mockApi.rejectPlan.mockResolvedValue({});
      render(<ActionBar runId={RUN_ID} state="AwaitingPlanApproval" onAction={vi.fn()} />);

      await userEvent.click(screen.getByRole("button", { name: /Reject Plan/i }));
      await userEvent.click(screen.getByText("Start fresh"));

      const rejectButtons = screen.getAllByRole("button", { name: /Reject Plan/i });
      await userEvent.click(rejectButtons[rejectButtons.length - 1]);

      await waitFor(() => {
        expect(mockApi.rejectPlan).toHaveBeenCalledWith(RUN_ID, undefined, "fresh");
      });
    });

    it("cancels the reject dialog via the Cancel button and resets state", async () => {
      render(<ActionBar runId={RUN_ID} state="AwaitingPlanApproval" onAction={vi.fn()} />);
      await userEvent.click(screen.getByRole("button", { name: /Reject Plan/i }));
      const textarea = screen.getByPlaceholderText(/describe what should change/i);
      await userEvent.type(textarea, "abandoned");

      await userEvent.click(screen.getByRole("button", { name: "Cancel" }));
      expect(
        screen.queryByText("This will reject the current plan and send it back for re-planning."),
      ).toBeNull();
      expect(mockApi.rejectPlan).not.toHaveBeenCalled();
    });

    it("cancels the reject dialog via the backdrop click", async () => {
      const { container } = render(
        <ActionBar runId={RUN_ID} state="AwaitingPlanApproval" onAction={vi.fn()} />,
      );
      await userEvent.click(screen.getByRole("button", { name: /Reject Plan/i }));
      const backdrop = container.querySelector(".absolute.inset-0.bg-black\\/60") as HTMLElement;
      await userEvent.click(backdrop);
      expect(
        screen.queryByText("This will reject the current plan and send it back for re-planning."),
      ).toBeNull();
    });

    it("disables Cancel/Reject while a reject submission is in flight and shows Working...", async () => {
      let resolveReject!: () => void;
      mockApi.rejectPlan.mockReturnValue(
        new Promise<void>((res) => {
          resolveReject = res;
        }),
      );
      render(<ActionBar runId={RUN_ID} state="AwaitingPlanApproval" onAction={vi.fn()} />);
      await userEvent.click(screen.getByRole("button", { name: /Reject Plan/i }));
      const rejectButtons = screen.getAllByRole("button", { name: /Reject Plan/i });
      await userEvent.click(rejectButtons[rejectButtons.length - 1]);

      expect(screen.getByText("Working...")).toBeDefined();
      expect((screen.getByRole("button", { name: "Cancel" }) as HTMLButtonElement).disabled).toBe(
        true,
      );

      resolveReject();
      await waitFor(() => {
        expect(screen.queryByText("Working...")).toBeNull();
      });
    });

    it("opens the Re-review Plan dialog and calls api.reReviewPlan", async () => {
      mockApi.reReviewPlan.mockResolvedValue({});
      const onAction = vi.fn();
      render(<ActionBar runId={RUN_ID} state="AwaitingPlanApproval" onAction={onAction} />);
      await userEvent.click(screen.getByRole("button", { name: /Re-review Plan/i }));
      expect(screen.getByText(/Run the plan reviewer again/i)).toBeDefined();
      await userEvent.click(screen.getByRole("button", { name: "Re-review" }));
      await waitFor(() => {
        expect(mockApi.reReviewPlan).toHaveBeenCalledWith(RUN_ID, undefined);
        expect(onAction).toHaveBeenCalledOnce();
      });
    });

    it("opens the Revise Plan dialog and calls api.revisePlan with a note", async () => {
      mockApi.revisePlan.mockResolvedValue({});
      render(<ActionBar runId={RUN_ID} state="AwaitingPlanApproval" onAction={vi.fn()} />);
      await userEvent.click(screen.getByRole("button", { name: /Revise Plan/i }));
      expect(screen.getByText(/automatically run the plan reviser/i)).toBeDefined();
      const textarea = screen.getByPlaceholderText(/tighten the rollout step/i);
      await userEvent.type(textarea, "tighten step 2");
      await userEvent.click(screen.getByRole("button", { name: "Revise" }));
      await waitFor(() => {
        expect(mockApi.revisePlan).toHaveBeenCalledWith(RUN_ID, "tighten step 2");
      });
    });
  });

  it("shows Approve & Complete for ReadyForHumanReview and calls api.approveReview", async () => {
    mockApi.approveReview.mockResolvedValue({});
    const onAction = vi.fn();
    render(<ActionBar runId={RUN_ID} state="ReadyForHumanReview" onAction={onAction} />);
    await userEvent.click(screen.getByRole("button", { name: /Approve & Complete/i }));
    await userEvent.click(screen.getByRole("button", { name: "Complete Run" }));
    await waitFor(() => {
      expect(mockApi.approveReview).toHaveBeenCalledWith(RUN_ID);
      expect(onAction).toHaveBeenCalledOnce();
    });
  });

  it.each(["Planning", "PlanReview", "PlanRevision", "Implementing", "AddressingReview"])(
    "shows a Pause button for active state '%s' and calls api.pauseRun",
    async (state) => {
      mockApi.pauseRun.mockResolvedValue({});
      const onAction = vi.fn();
      render(<ActionBar runId={RUN_ID} state={state} onAction={onAction} />);
      await userEvent.click(screen.getByRole("button", { name: /Pause/i }));
      const pauseButtons = screen.getAllByRole("button", { name: "Pause" });
      await userEvent.click(pauseButtons[pauseButtons.length - 1]);
      await waitFor(() => {
        expect(mockApi.pauseRun).toHaveBeenCalledWith(RUN_ID);
        expect(onAction).toHaveBeenCalledOnce();
      });
    },
  );

  it.each(["AIBlocked", "HumanClarificationNeeded", "Failed"])(
    "shows a Resume button for state '%s' and calls api.resumeRun",
    async (state) => {
      mockApi.resumeRun.mockResolvedValue({});
      const onAction = vi.fn();
      render(<ActionBar runId={RUN_ID} state={state} onAction={onAction} />);
      await userEvent.click(screen.getByRole("button", { name: /Resume/i }));
      const resumeButtons = screen.getAllByRole("button", { name: "Resume" });
      await userEvent.click(resumeButtons[resumeButtons.length - 1]);
      await waitFor(() => {
        expect(mockApi.resumeRun).toHaveBeenCalledWith(RUN_ID);
        expect(onAction).toHaveBeenCalledOnce();
      });
    },
  );

  it("shows the Answer Questions button for HumanClarificationNeeded and calls onScrollToQuestions", async () => {
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

  it.each([
    ["Todo", "Start Run"],
    ["Planning", "Retry Planning"],
    ["PlanRevision", "Retry Plan Revision"],
    ["PlanReview", "Retry Plan Review"],
    ["Implementing", "Retry Execution"],
    ["AIReview", "Retry Code Review"],
    ["AddressingReview", "Retry Remediation"],
  ])("shows the retry-labeled button '%s' -> '%s' and calls api.retryStage", async (state, label) => {
    mockApi.retryStage.mockResolvedValue({});
    const onAction = vi.fn();
    render(<ActionBar runId={RUN_ID} state={state} onAction={onAction} />);
    const retryBtn = screen.getByRole("button", { name: new RegExp(label, "i") });
    expect(retryBtn).toBeDefined();
    await userEvent.click(retryBtn);
    await userEvent.click(screen.getByRole("button", { name: "Retry" }));
    await waitFor(() => {
      expect(mockApi.retryStage).toHaveBeenCalledWith(RUN_ID);
      expect(onAction).toHaveBeenCalledOnce();
    });
  });

  it("closes the confirm dialog via Cancel without calling the API", async () => {
    render(<ActionBar runId={RUN_ID} state="ReadyForHumanReview" onAction={vi.fn()} />);
    await userEvent.click(screen.getByRole("button", { name: /Approve & Complete/i }));
    await userEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(mockApi.approveReview).not.toHaveBeenCalled();
    expect(screen.queryByText(/This will mark the run as complete/i)).toBeNull();
  });

  it("keeps the ConfirmDialog action invocation silent and still closes when the API call rejects", async () => {
    mockApi.approveReview.mockRejectedValue(new Error("boom"));
    const onAction = vi.fn();
    render(<ActionBar runId={RUN_ID} state="ReadyForHumanReview" onAction={onAction} />);
    await userEvent.click(screen.getByRole("button", { name: /Approve & Complete/i }));
    await userEvent.click(screen.getByRole("button", { name: "Complete Run" }));

    await waitFor(() => {
      expect(screen.queryByText(/This will mark the run as complete/i)).toBeNull();
    });
    // onAction should not be called when the action throws
    expect(onAction).not.toHaveBeenCalled();
  });

  it("shows the loading spinner label while a ConfirmDialog action is in flight", async () => {
    let resolveApprove!: () => void;
    mockApi.approveReview.mockReturnValue(
      new Promise<void>((res) => {
        resolveApprove = res;
      }),
    );
    render(<ActionBar runId={RUN_ID} state="ReadyForHumanReview" onAction={vi.fn()} />);
    await userEvent.click(screen.getByRole("button", { name: /Approve & Complete/i }));
    await userEvent.click(screen.getByRole("button", { name: "Complete Run" }));
    expect(screen.getByText("Working...")).toBeDefined();
    resolveApprove();
    await waitFor(() => {
      expect(screen.queryByText("Working...")).toBeNull();
    });
  });

  it("falls back to generic 'Retry' label and 'Retry Stage' title for an unmapped retry state", () => {
    // AddressingReview IS in RETRY_LABELS, so pick a state outside RETRY_LABELS
    // and outside all other `show` conditions to confirm nothing renders —
    // this documents that unmapped states produce no action bar at all.
    const { container } = render(
      <ActionBar runId={RUN_ID} state="SomeUnknownState" onAction={vi.fn()} />,
    );
    expect(container.firstChild).toBeNull();
  });
});
