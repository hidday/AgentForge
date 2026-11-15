import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
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

const mockApi = api as unknown as Record<string, ReturnType<typeof vi.fn>>;

describe("ActionBar", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    for (const key of Object.keys(mockApi)) {
      mockApi[key].mockResolvedValue({ ok: true, state: "Done" });
    }
  });

  it("renders nothing for a state with no available actions", () => {
    const { container } = render(
      <ActionBar runId="run-1" state="Done" onAction={vi.fn()} />,
    );
    expect(container.firstChild).toBeNull();
  });

  it("shows Approve Plan and Reject Plan for AwaitingPlanApproval, plus re-review/revise", () => {
    render(
      <ActionBar runId="run-1" state="AwaitingPlanApproval" onAction={vi.fn()} />,
    );

    expect(screen.getByRole("button", { name: /approve plan/i })).toBeDefined();
    expect(screen.getByRole("button", { name: /reject plan/i })).toBeDefined();
    expect(screen.getByRole("button", { name: /re-review plan/i })).toBeDefined();
    expect(screen.getByRole("button", { name: /revise plan/i })).toBeDefined();
  });

  it("does not show the optional-questions button when hasOptionalQuestions is false", () => {
    render(
      <ActionBar
        runId="run-1"
        state="AwaitingPlanApproval"
        onAction={vi.fn()}
        hasOptionalQuestions={false}
      />,
    );
    expect(
      screen.queryByRole("button", { name: /answer optional questions/i }),
    ).toBeNull();
  });

  it("shows the optional-questions button when hasOptionalQuestions is true and calls onScrollToQuestions", async () => {
    const onScrollToQuestions = vi.fn();
    render(
      <ActionBar
        runId="run-1"
        state="AwaitingPlanApproval"
        onAction={vi.fn()}
        hasOptionalQuestions={true}
        onScrollToQuestions={onScrollToQuestions}
      />,
    );

    const btn = screen.getByRole("button", { name: /answer optional questions/i });
    await userEvent.click(btn);
    expect(onScrollToQuestions).toHaveBeenCalledOnce();
  });

  it("shows Answer Questions button for HumanClarificationNeeded and wires onScrollToQuestions", async () => {
    const onScrollToQuestions = vi.fn();
    render(
      <ActionBar
        runId="run-1"
        state="HumanClarificationNeeded"
        onAction={vi.fn()}
        onScrollToQuestions={onScrollToQuestions}
      />,
    );

    const btn = screen.getByRole("button", { name: "Answer Questions" });
    await userEvent.click(btn);
    expect(onScrollToQuestions).toHaveBeenCalledOnce();

    // Resume is also available in this state (AIBlocked/HumanClarificationNeeded/Failed)
    expect(screen.getByRole("button", { name: /resume/i })).toBeDefined();
  });

  it("shows Pause for an active-category state", () => {
    render(<ActionBar runId="run-1" state="Implementing" onAction={vi.fn()} />);
    expect(screen.getByRole("button", { name: /pause/i })).toBeDefined();
    // Implementing also maps to a retry label
    expect(screen.getByRole("button", { name: /retry execution/i })).toBeDefined();
  });

  it("shows Resume for AIBlocked and Failed states", () => {
    const { rerender } = render(
      <ActionBar runId="run-1" state="AIBlocked" onAction={vi.fn()} />,
    );
    expect(screen.getByRole("button", { name: /resume/i })).toBeDefined();

    rerender(<ActionBar runId="run-1" state="Failed" onAction={vi.fn()} />);
    expect(screen.getByRole("button", { name: /resume/i })).toBeDefined();
  });

  it("shows a state-specific retry label for Todo (Start Run)", () => {
    render(<ActionBar runId="run-1" state="Todo" onAction={vi.fn()} />);
    expect(screen.getByRole("button", { name: /start run/i })).toBeDefined();
  });

  it("falls back to a generic Retry label for an unmapped-but-active state is not shown; unmapped state with no actions renders null", () => {
    const { container } = render(
      <ActionBar runId="run-1" state="SomeUnknownState" onAction={vi.fn()} />,
    );
    expect(container.firstChild).toBeNull();
  });

  it("shows Approve & Complete for ReadyForHumanReview", () => {
    render(
      <ActionBar runId="run-1" state="ReadyForHumanReview" onAction={vi.fn()} />,
    );
    expect(
      screen.getByRole("button", { name: /approve & complete/i }),
    ).toBeDefined();
  });

  it("opens confirm dialog and calls api.approvePlan with trimmed note, then onAction", async () => {
    const onAction = vi.fn();
    render(
      <ActionBar runId="run-42" state="AwaitingPlanApproval" onAction={onAction} />,
    );

    await userEvent.click(screen.getByRole("button", { name: /approve plan/i }));

    // Confirm dialog should now be open with a notes textarea
    const textarea = screen.getByRole("textbox");
    await userEvent.type(textarea, "  watch out for X  ");

    const confirmBtn = screen.getByRole("button", { name: /approve & start/i });
    await userEvent.click(confirmBtn);

    await waitFor(() => {
      expect(mockApi.approvePlan).toHaveBeenCalledWith("run-42", "watch out for X");
      expect(onAction).toHaveBeenCalledOnce();
    });
  });

  it("calls api.pauseRun with no note when confirming Pause", async () => {
    const onAction = vi.fn();
    render(<ActionBar runId="run-7" state="Implementing" onAction={onAction} />);

    await userEvent.click(screen.getByRole("button", { name: /pause/i }));
    const dialogBox = screen.getByText("Pause Run").closest(".relative") as HTMLElement;
    await userEvent.click(within(dialogBox).getByRole("button", { name: "Pause" }));

    await waitFor(() => {
      expect(mockApi.pauseRun).toHaveBeenCalledWith("run-7");
      expect(onAction).toHaveBeenCalledOnce();
    });
  });

  it("does not call onAction when the confirm action rejects", async () => {
    mockApi.pauseRun.mockRejectedValue(new Error("network down"));
    const onAction = vi.fn();
    render(<ActionBar runId="run-7" state="Implementing" onAction={onAction} />);

    await userEvent.click(screen.getByRole("button", { name: /pause/i }));
    const dialogBox = screen.getByText("Pause Run").closest(".relative") as HTMLElement;
    await userEvent.click(within(dialogBox).getByRole("button", { name: "Pause" }));

    await waitFor(() => {
      expect(mockApi.pauseRun).toHaveBeenCalledOnce();
    });
    expect(onAction).not.toHaveBeenCalled();
  });

  it("closes the confirm dialog on cancel without calling the action", async () => {
    render(<ActionBar runId="run-7" state="Implementing" onAction={vi.fn()} />);

    await userEvent.click(screen.getByRole("button", { name: /pause/i }));
    expect(screen.getByText("Pause Run")).toBeDefined();

    await userEvent.click(screen.getByRole("button", { name: "Cancel" }));

    expect(screen.queryByText("Pause Run")).toBeNull();
    expect(mockApi.pauseRun).not.toHaveBeenCalled();
  });

  it("opens the reject dialog, defaults to iterate mode, and submits trimmed context with chosen mode", async () => {
    const onAction = vi.fn();
    render(
      <ActionBar runId="run-9" state="AwaitingPlanApproval" onAction={onAction} />,
    );

    await userEvent.click(screen.getByRole("button", { name: /reject plan/i }));
    expect(screen.getByRole("heading", { name: "Reject Plan" })).toBeDefined();

    await userEvent.click(screen.getByText("Start fresh"));

    const textarea = screen.getByPlaceholderText(
      /optional: describe what should change/i,
    );
    await userEvent.type(textarea, "  change the approach  ");

    const dialogBox = screen
      .getByRole("heading", { name: "Reject Plan" })
      .closest(".relative") as HTMLElement;
    const confirmBtn = within(dialogBox).getByRole("button", { name: "Reject Plan" });
    await userEvent.click(confirmBtn);

    await waitFor(() => {
      expect(mockApi.rejectPlan).toHaveBeenCalledWith(
        "run-9",
        "change the approach",
        "fresh",
      );
      expect(onAction).toHaveBeenCalledOnce();
    });
  });

  it("submits reject with undefined context when left blank, defaulting to iterate mode", async () => {
    render(
      <ActionBar runId="run-9" state="AwaitingPlanApproval" onAction={vi.fn()} />,
    );

    await userEvent.click(screen.getByRole("button", { name: /reject plan/i }));
    const dialogBox = screen
      .getByRole("heading", { name: "Reject Plan" })
      .closest(".relative") as HTMLElement;
    const confirmBtn = within(dialogBox).getByRole("button", { name: "Reject Plan" });
    await userEvent.click(confirmBtn);

    await waitFor(() => {
      expect(mockApi.rejectPlan).toHaveBeenCalledWith("run-9", undefined, "iterate");
    });
  });

  it("cancels the reject dialog without calling the api", async () => {
    render(
      <ActionBar runId="run-9" state="AwaitingPlanApproval" onAction={vi.fn()} />,
    );

    await userEvent.click(screen.getByRole("button", { name: /reject plan/i }));
    expect(screen.getByRole("heading", { name: "Reject Plan" })).toBeDefined();
    await userEvent.click(screen.getByRole("button", { name: "Cancel" }));

    expect(screen.queryByRole("heading", { name: "Reject Plan" })).toBeNull();
    expect(mockApi.rejectPlan).not.toHaveBeenCalled();
  });

  it("calls api.reReviewPlan with note from the re-review dialog", async () => {
    render(
      <ActionBar runId="run-5" state="AwaitingPlanApproval" onAction={vi.fn()} />,
    );

    await userEvent.click(screen.getByRole("button", { name: /re-review plan/i }));
    const textarea = screen.getByPlaceholderText(/focus on the test plan/i);
    await userEvent.type(textarea, "check risk section");

    await userEvent.click(screen.getByRole("button", { name: /^re-review$/i }));

    await waitFor(() => {
      expect(mockApi.reReviewPlan).toHaveBeenCalledWith("run-5", "check risk section");
    });
  });

  it("calls api.revisePlan with note from the revise dialog", async () => {
    render(
      <ActionBar runId="run-6" state="AwaitingPlanApproval" onAction={vi.fn()} />,
    );

    await userEvent.click(screen.getByRole("button", { name: /revise plan/i }));
    const textarea = screen.getByPlaceholderText(/tighten the rollout step/i);
    await userEvent.type(textarea, "tighten step 3");

    await userEvent.click(screen.getByRole("button", { name: /^revise$/i }));

    await waitFor(() => {
      expect(mockApi.revisePlan).toHaveBeenCalledWith("run-6", "tighten step 3");
    });
  });

  it("calls api.retryStage for a retry-labelled state", async () => {
    render(<ActionBar runId="run-8" state="PlanReview" onAction={vi.fn()} />);

    await userEvent.click(screen.getByRole("button", { name: /retry plan review/i }));
    await userEvent.click(screen.getByRole("button", { name: "Retry" }));

    await waitFor(() => {
      expect(mockApi.retryStage).toHaveBeenCalledWith("run-8");
    });
  });

  it("calls api.approveReview when confirming Approve & Complete", async () => {
    const onAction = vi.fn();
    render(
      <ActionBar runId="run-10" state="ReadyForHumanReview" onAction={onAction} />,
    );

    await userEvent.click(screen.getByRole("button", { name: /approve & complete/i }));
    const dialogBox = screen
      .getByRole("heading", { name: "Approve & Complete" })
      .closest(".relative") as HTMLElement;
    await userEvent.click(within(dialogBox).getByRole("button", { name: "Complete Run" }));

    await waitFor(() => {
      expect(mockApi.approveReview).toHaveBeenCalledWith("run-10");
      expect(onAction).toHaveBeenCalledOnce();
    });
  });

  it("calls api.resumeRun when confirming Resume", async () => {
    const onAction = vi.fn();
    render(<ActionBar runId="run-11" state="AIBlocked" onAction={onAction} />);

    await userEvent.click(screen.getByRole("button", { name: /resume/i }));
    const dialogBox = screen.getByText("Resume Run").closest(".relative") as HTMLElement;
    await userEvent.click(within(dialogBox).getByRole("button", { name: "Resume" }));

    await waitFor(() => {
      expect(mockApi.resumeRun).toHaveBeenCalledWith("run-11");
      expect(onAction).toHaveBeenCalledOnce();
    });
  });

  it("switches the reject dialog back to iterate mode when clicking 'Revise plan'", async () => {
    render(
      <ActionBar runId="run-9" state="AwaitingPlanApproval" onAction={vi.fn()} />,
    );

    await userEvent.click(screen.getByRole("button", { name: /reject plan/i }));
    await userEvent.click(screen.getByText("Start fresh"));
    await userEvent.click(screen.getByText("Revise plan"));

    const dialogBox = screen
      .getByRole("heading", { name: "Reject Plan" })
      .closest(".relative") as HTMLElement;
    const confirmBtn = within(dialogBox).getByRole("button", { name: "Reject Plan" });
    await userEvent.click(confirmBtn);

    await waitFor(() => {
      expect(mockApi.rejectPlan).toHaveBeenCalledWith("run-9", undefined, "iterate");
    });
  });
});
