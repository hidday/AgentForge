import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

vi.mock("@/api/client.ts", () => ({
  api: {
    rejectPlan: vi.fn(),
    reReviewPlan: vi.fn(),
    revisePlan: vi.fn(),
    approvePlan: vi.fn(),
    approveReview: vi.fn(),
    pauseRun: vi.fn(),
    resumeRun: vi.fn(),
    retryStage: vi.fn(),
  },
}));

import { ActionBar } from "./ActionBar.tsx";
import { api } from "@/api/client.ts";

const mockApi = api as unknown as Record<string, ReturnType<typeof vi.fn>>;

describe("ActionBar", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    for (const fn of Object.values(mockApi)) fn.mockResolvedValue(undefined);
  });

  it("renders nothing for a state with no applicable actions", () => {
    const { container } = render(
      <ActionBar runId="run-1" state="Done" onAction={vi.fn()} />,
    );
    expect(container.firstChild).toBeNull();
  });

  describe("AwaitingPlanApproval", () => {
    it("shows Approve Plan, Reject Plan, Re-review Plan and Revise Plan actions", () => {
      render(<ActionBar runId="run-1" state="AwaitingPlanApproval" onAction={vi.fn()} />);
      expect(screen.getByRole("button", { name: /approve plan/i })).toBeDefined();
      expect(screen.getByRole("button", { name: /reject plan/i })).toBeDefined();
      expect(screen.getByRole("button", { name: /re-review plan/i })).toBeDefined();
      expect(screen.getByRole("button", { name: /revise plan/i })).toBeDefined();
    });

    it("shows the optional-questions button only when hasOptionalQuestions is true", () => {
      const { rerender } = render(
        <ActionBar runId="run-1" state="AwaitingPlanApproval" onAction={vi.fn()} />,
      );
      expect(screen.queryByRole("button", { name: /answer optional questions/i })).toBeNull();

      rerender(
        <ActionBar
          runId="run-1"
          state="AwaitingPlanApproval"
          onAction={vi.fn()}
          hasOptionalQuestions
        />,
      );
      expect(screen.getByRole("button", { name: /answer optional questions/i })).toBeDefined();
    });

    it("clicking the optional-questions button calls onScrollToQuestions", async () => {
      const onScroll = vi.fn();
      render(
        <ActionBar
          runId="run-1"
          state="AwaitingPlanApproval"
          onAction={vi.fn()}
          hasOptionalQuestions
          onScrollToQuestions={onScroll}
        />,
      );
      await userEvent.click(screen.getByRole("button", { name: /answer optional questions/i }));
      expect(onScroll).toHaveBeenCalledTimes(1);
    });

    it("Approve Plan opens a confirm dialog and, on confirm, calls api.approvePlan with the note and then onAction", async () => {
      const onAction = vi.fn();
      render(<ActionBar runId="run-1" state="AwaitingPlanApproval" onAction={onAction} />);
      await userEvent.click(screen.getByRole("button", { name: /approve plan/i }));

      expect(screen.getByText("Approve Plan").closest("div")).toBeDefined();
      expect(
        screen.getByText(
          "This will approve the current plan and start implementation. The AI agent will begin coding.",
        ),
      ).toBeDefined();

      await userEvent.type(screen.getByRole("textbox"), "watch the edge cases");
      await userEvent.click(screen.getByRole("button", { name: "Approve & Start" }));

      await waitFor(() => {
        expect(mockApi.approvePlan).toHaveBeenCalledWith("run-1", "watch the edge cases");
      });
      expect(onAction).toHaveBeenCalledTimes(1);
    });

    it("Re-review Plan opens its own confirm dialog and calls api.reReviewPlan on confirm", async () => {
      const onAction = vi.fn();
      render(<ActionBar runId="run-1" state="AwaitingPlanApproval" onAction={onAction} />);
      await userEvent.click(screen.getByRole("button", { name: /re-review plan/i }));
      expect(
        screen.getByText(
          "Run the plan reviewer again against the current plan. The run will return to Awaiting Plan Approval after the review completes.",
        ),
      ).toBeDefined();
      await userEvent.click(screen.getByRole("button", { name: "Re-review" }));
      await waitFor(() => {
        expect(mockApi.reReviewPlan).toHaveBeenCalledWith("run-1", undefined);
      });
      expect(onAction).toHaveBeenCalledTimes(1);
    });

    it("Revise Plan opens its own confirm dialog and calls api.revisePlan on confirm", async () => {
      const onAction = vi.fn();
      render(<ActionBar runId="run-1" state="AwaitingPlanApproval" onAction={onAction} />);
      await userEvent.click(screen.getByRole("button", { name: /revise plan/i }));
      await userEvent.click(screen.getByRole("button", { name: "Revise" }));
      await waitFor(() => {
        expect(mockApi.revisePlan).toHaveBeenCalledWith("run-1", undefined);
      });
      expect(onAction).toHaveBeenCalledTimes(1);
    });

    it("Reject Plan opens the custom reject dialog (not the generic ConfirmDialog)", async () => {
      render(<ActionBar runId="run-1" state="AwaitingPlanApproval" onAction={vi.fn()} />);
      await userEvent.click(screen.getByRole("button", { name: /reject plan/i }));
      expect(
        screen.getByText("This will reject the current plan and send it back for re-planning."),
      ).toBeDefined();
      expect(screen.getByText("Revise plan")).toBeDefined();
      expect(screen.getByText("Start fresh")).toBeDefined();
    });

    it("confirming the reject dialog calls api.rejectPlan with trimmed feedback and the default 'iterate' mode", async () => {
      const onAction = vi.fn();
      render(<ActionBar runId="run-1" state="AwaitingPlanApproval" onAction={onAction} />);
      await userEvent.click(screen.getByRole("button", { name: /reject plan/i }));
      await userEvent.type(
        screen.getByPlaceholderText(/describe what should change/i),
        "  tighten the rollback step  ",
      );
      await userEvent.click(screen.getByRole("button", { name: "Reject Plan" }));

      await waitFor(() => {
        expect(mockApi.rejectPlan).toHaveBeenCalledWith(
          "run-1",
          "tighten the rollback step",
          "iterate",
        );
      });
      expect(onAction).toHaveBeenCalledTimes(1);
    });

    it("switching reject mode to 'fresh' and confirming with empty feedback passes undefined context and 'fresh' mode", async () => {
      render(<ActionBar runId="run-1" state="AwaitingPlanApproval" onAction={vi.fn()} />);
      await userEvent.click(screen.getByRole("button", { name: /reject plan/i }));
      await userEvent.click(screen.getByText("Start fresh"));
      await userEvent.click(screen.getByRole("button", { name: "Reject Plan" }));

      await waitFor(() => {
        expect(mockApi.rejectPlan).toHaveBeenCalledWith("run-1", undefined, "fresh");
      });
    });

    it("cancelling the reject dialog closes it without calling the API", async () => {
      render(<ActionBar runId="run-1" state="AwaitingPlanApproval" onAction={vi.fn()} />);
      await userEvent.click(screen.getByRole("button", { name: /reject plan/i }));
      await userEvent.type(
        screen.getByPlaceholderText(/describe what should change/i),
        "some feedback",
      );
      await userEvent.click(screen.getByRole("button", { name: "Cancel" }));

      expect(
        screen.queryByText("This will reject the current plan and send it back for re-planning."),
      ).toBeNull();
      expect(mockApi.rejectPlan).not.toHaveBeenCalled();
    });
  });

  it("ReadyForHumanReview shows Approve & Complete and calls api.approveReview on confirm", async () => {
    const onAction = vi.fn();
    render(<ActionBar runId="run-1" state="ReadyForHumanReview" onAction={onAction} />);
    await userEvent.click(screen.getByRole("button", { name: /approve & complete/i }));
    await userEvent.click(screen.getByRole("button", { name: "Complete Run" }));
    await waitFor(() => {
      expect(mockApi.approveReview).toHaveBeenCalledWith("run-1");
    });
    expect(onAction).toHaveBeenCalledTimes(1);
  });

  it("an active-category state (e.g. Implementing) shows Pause and calls api.pauseRun on confirm", async () => {
    const onAction = vi.fn();
    render(<ActionBar runId="run-1" state="Implementing" onAction={onAction} />);
    await userEvent.click(screen.getByRole("button", { name: /pause/i }));
    await userEvent.click(screen.getByRole("button", { name: "Pause" }));
    await waitFor(() => {
      expect(mockApi.pauseRun).toHaveBeenCalledWith("run-1");
    });
    expect(onAction).toHaveBeenCalledTimes(1);
  });

  it.each(["AIBlocked", "HumanClarificationNeeded", "Failed"])(
    "state %s shows Resume and calls api.resumeRun on confirm",
    async (state) => {
      const onAction = vi.fn();
      render(<ActionBar runId="run-1" state={state} onAction={onAction} />);
      await userEvent.click(screen.getByRole("button", { name: /resume/i }));
      await userEvent.click(screen.getByRole("button", { name: "Resume" }));
      await waitFor(() => {
        expect(mockApi.resumeRun).toHaveBeenCalledWith("run-1");
      });
      expect(onAction).toHaveBeenCalledTimes(1);
    },
  );

  it("Todo state shows the special-cased 'Start Run' retry label and calls api.retryStage on confirm", async () => {
    const onAction = vi.fn();
    render(<ActionBar runId="run-1" state="Todo" onAction={onAction} />);
    const button = screen.getByRole("button", { name: /start run/i });
    expect(button).toBeDefined();
    await userEvent.click(button);
    await userEvent.click(screen.getByRole("button", { name: "Retry" }));
    await waitFor(() => {
      expect(mockApi.retryStage).toHaveBeenCalledWith("run-1");
    });
    expect(onAction).toHaveBeenCalledTimes(1);
  });

  it("a non-Todo retry state (e.g. Planning) shows its specific retry label", () => {
    render(<ActionBar runId="run-1" state="Planning" onAction={vi.fn()} />);
    expect(screen.getByRole("button", { name: "Retry Planning" })).toBeDefined();
  });

  it("HumanClarificationNeeded shows the Answer Questions button, which calls onScrollToQuestions", async () => {
    const onScroll = vi.fn();
    render(
      <ActionBar
        runId="run-1"
        state="HumanClarificationNeeded"
        onAction={vi.fn()}
        onScrollToQuestions={onScroll}
      />,
    );
    await userEvent.click(screen.getByRole("button", { name: /^answer questions$/i }));
    expect(onScroll).toHaveBeenCalledTimes(1);
  });

  it("cancelling a generic confirm dialog closes it without invoking the action or onAction", async () => {
    const onAction = vi.fn();
    render(<ActionBar runId="run-1" state="Implementing" onAction={onAction} />);
    await userEvent.click(screen.getByRole("button", { name: /pause/i }));
    await userEvent.click(screen.getByRole("button", { name: "Cancel" }));

    expect(screen.queryByText("This will pause the run. You can resume it later.")).toBeNull();
    expect(mockApi.pauseRun).not.toHaveBeenCalled();
    expect(onAction).not.toHaveBeenCalled();
  });

  it("when the dialog action rejects, the dialog still closes and onAction is not called", async () => {
    mockApi.pauseRun.mockRejectedValue(new Error("network error"));
    const onAction = vi.fn();
    render(<ActionBar runId="run-1" state="Implementing" onAction={onAction} />);
    await userEvent.click(screen.getByRole("button", { name: /pause/i }));
    await userEvent.click(screen.getByRole("button", { name: "Pause" }));

    await waitFor(() => {
      expect(
        screen.queryByText("This will pause the run. You can resume it later."),
      ).toBeNull();
    });
    expect(onAction).not.toHaveBeenCalled();
  });
});
