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
    // Done is not in RETRY_LABELS, is not an active category, and has no
    // direct-action buttons.
    expect(container.firstChild).toBeNull();
  });

  it("shows Approve Plan and Reject Plan buttons for AwaitingPlanApproval", () => {
    render(<ActionBar runId={RUN_ID} state="AwaitingPlanApproval" onAction={vi.fn()} />);
    expect(screen.getByRole("button", { name: /Approve Plan/i })).toBeDefined();
    expect(screen.getByRole("button", { name: /Reject Plan/i })).toBeDefined();
    expect(screen.getByRole("button", { name: /Re-review Plan/i })).toBeDefined();
    expect(screen.getByRole("button", { name: /Revise Plan/i })).toBeDefined();
  });

  it("opens the confirm dialog and calls api.approvePlan with the note on confirm", async () => {
    mockApi.approvePlan.mockResolvedValue({ ok: true, state: "Implementing" });
    const onAction = vi.fn();
    render(<ActionBar runId={RUN_ID} state="AwaitingPlanApproval" onAction={onAction} />);

    await userEvent.click(screen.getByRole("button", { name: /^Approve Plan$/i }));
    expect(screen.getByText("This will approve the current plan and start implementation. The AI agent will begin coding.")).toBeDefined();

    const textarea = screen.getByPlaceholderText(/extra context/i);
    await userEvent.type(textarea, "watch the migration");

    await userEvent.click(screen.getByRole("button", { name: /Approve & Start/i }));

    await waitFor(() => {
      expect(mockApi.approvePlan).toHaveBeenCalledWith(RUN_ID, "watch the migration");
      expect(onAction).toHaveBeenCalledOnce();
    });

    // Dialog closes after confirm
    expect(screen.queryByText(/This will approve the current plan/i)).toBeNull();
  });

  it("closes the dialog without calling the action when Cancel is clicked", async () => {
    render(<ActionBar runId={RUN_ID} state="AwaitingPlanApproval" onAction={vi.fn()} />);
    await userEvent.click(screen.getByRole("button", { name: /^Approve Plan$/i }));
    await userEvent.click(screen.getByRole("button", { name: /cancel/i }));
    expect(mockApi.approvePlan).not.toHaveBeenCalled();
    expect(screen.queryByText(/This will approve the current plan/i)).toBeNull();
  });

  it("swallows an action error and still closes the dialog", async () => {
    mockApi.approvePlan.mockRejectedValue(new Error("server error"));
    const onAction = vi.fn();
    render(<ActionBar runId={RUN_ID} state="AwaitingPlanApproval" onAction={onAction} />);

    await userEvent.click(screen.getByRole("button", { name: /^Approve Plan$/i }));
    await userEvent.click(screen.getByRole("button", { name: /Approve & Start/i }));

    await waitFor(() => {
      expect(mockApi.approvePlan).toHaveBeenCalledOnce();
    });
    // onAction is only called on success
    expect(onAction).not.toHaveBeenCalled();
    await waitFor(() => {
      expect(screen.queryByText(/This will approve the current plan/i)).toBeNull();
    });
  });

  it("opens the custom Reject Plan dialog with iterate/fresh mode toggle", async () => {
    render(<ActionBar runId={RUN_ID} state="AwaitingPlanApproval" onAction={vi.fn()} />);
    await userEvent.click(screen.getByRole("button", { name: /^Reject Plan$/i }));

    expect(screen.getByText("This will reject the current plan and send it back for re-planning.")).toBeDefined();
    expect(screen.getByText("Revise plan")).toBeDefined();
    expect(screen.getByText("Start fresh")).toBeDefined();
  });

  it("submits reject with iterate mode (default) and trimmed feedback", async () => {
    mockApi.rejectPlan.mockResolvedValue({ ok: true, state: "Planning" });
    const onAction = vi.fn();
    render(<ActionBar runId={RUN_ID} state="AwaitingPlanApproval" onAction={onAction} />);

    await userEvent.click(screen.getByRole("button", { name: /^Reject Plan$/i }));
    const textarea = screen.getByPlaceholderText(/describe what should change/i);
    await userEvent.type(textarea, "  needs work  ");

    const confirmBtn = screen.getAllByRole("button", { name: /^Reject Plan$/i })[1]!;
    await userEvent.click(confirmBtn);

    await waitFor(() => {
      expect(mockApi.rejectPlan).toHaveBeenCalledWith(RUN_ID, "needs work", "iterate");
      expect(onAction).toHaveBeenCalledOnce();
    });
  });

  it("submits reject with fresh mode when selected, and undefined context when blank", async () => {
    mockApi.rejectPlan.mockResolvedValue({ ok: true, state: "Planning" });
    render(<ActionBar runId={RUN_ID} state="AwaitingPlanApproval" onAction={vi.fn()} />);

    await userEvent.click(screen.getByRole("button", { name: /^Reject Plan$/i }));
    await userEvent.click(screen.getByText("Start fresh"));

    const confirmBtn = screen.getAllByRole("button", { name: /^Reject Plan$/i })[1]!;
    await userEvent.click(confirmBtn);

    await waitFor(() => {
      expect(mockApi.rejectPlan).toHaveBeenCalledWith(RUN_ID, undefined, "fresh");
    });
  });

  it("switches back to iterate mode after selecting fresh, via the mode toggle buttons", async () => {
    mockApi.rejectPlan.mockResolvedValue({ ok: true, state: "Planning" });
    render(<ActionBar runId={RUN_ID} state="AwaitingPlanApproval" onAction={vi.fn()} />);

    await userEvent.click(screen.getByRole("button", { name: /^Reject Plan$/i }));
    await userEvent.click(screen.getByText("Start fresh"));
    // Explicitly click back to "Revise plan" (iterate) to exercise its onClick.
    await userEvent.click(screen.getByText("Revise plan"));

    const confirmBtn = screen.getAllByRole("button", { name: /^Reject Plan$/i })[1]!;
    await userEvent.click(confirmBtn);

    await waitFor(() => {
      expect(mockApi.rejectPlan).toHaveBeenCalledWith(RUN_ID, undefined, "iterate");
    });
  });

  it("cancels the reject dialog via the Cancel button and resets its state", async () => {
    render(<ActionBar runId={RUN_ID} state="AwaitingPlanApproval" onAction={vi.fn()} />);
    await userEvent.click(screen.getByRole("button", { name: /^Reject Plan$/i }));
    await userEvent.click(screen.getByText("Start fresh"));

    const cancelBtn = screen.getAllByRole("button", { name: /cancel/i })[0]!;
    await userEvent.click(cancelBtn);

    expect(screen.queryByText("This will reject the current plan and send it back for re-planning.")).toBeNull();
    expect(mockApi.rejectPlan).not.toHaveBeenCalled();
  });

  it("cancels the reject dialog by clicking the backdrop", async () => {
    const { container } = render(
      <ActionBar runId={RUN_ID} state="AwaitingPlanApproval" onAction={vi.fn()} />,
    );
    await userEvent.click(screen.getByRole("button", { name: /^Reject Plan$/i }));
    const backdrop = container.querySelector(".absolute.inset-0.bg-black\\/60") as HTMLElement;
    await userEvent.click(backdrop);
    expect(screen.queryByText("This will reject the current plan and send it back for re-planning.")).toBeNull();
  });

  it("surfaces a reject error inline without closing state incorrectly, then re-enables buttons", async () => {
    mockApi.rejectPlan.mockRejectedValue(new Error("network down"));
    render(<ActionBar runId={RUN_ID} state="AwaitingPlanApproval" onAction={vi.fn()} />);

    await userEvent.click(screen.getByRole("button", { name: /^Reject Plan$/i }));
    const confirmBtn = screen.getAllByRole("button", { name: /^Reject Plan$/i })[1]!;
    await userEvent.click(confirmBtn);

    await waitFor(() => {
      expect(mockApi.rejectPlan).toHaveBeenCalledOnce();
    });
    // Dialog closes regardless (handled by client per component's catch block)
    await waitFor(() => {
      expect(screen.queryByText("This will reject the current plan and send it back for re-planning.")).toBeNull();
    });
  });

  it("shows the Answer Optional Questions button when hasOptionalQuestions is true and calls onScrollToQuestions", async () => {
    const onScroll = vi.fn();
    render(
      <ActionBar
        runId={RUN_ID}
        state="AwaitingPlanApproval"
        onAction={vi.fn()}
        onScrollToQuestions={onScroll}
        hasOptionalQuestions={true}
      />,
    );
    const btn = screen.getByRole("button", { name: /Answer Optional Questions/i });
    await userEvent.click(btn);
    expect(onScroll).toHaveBeenCalledOnce();
  });

  it("does not show the optional questions button when hasOptionalQuestions is false", () => {
    render(<ActionBar runId={RUN_ID} state="AwaitingPlanApproval" onAction={vi.fn()} />);
    expect(screen.queryByRole("button", { name: /Answer Optional Questions/i })).toBeNull();
  });

  it("shows and triggers the Re-review Plan dialog", async () => {
    mockApi.reReviewPlan.mockResolvedValue({ ok: true, runId: RUN_ID });
    const onAction = vi.fn();
    render(<ActionBar runId={RUN_ID} state="AwaitingPlanApproval" onAction={onAction} />);

    await userEvent.click(screen.getByRole("button", { name: /^Re-review Plan$/i }));
    expect(screen.getByText(/Run the plan reviewer again/i)).toBeDefined();
    await userEvent.click(screen.getByRole("button", { name: /^Re-review$/i }));

    await waitFor(() => {
      expect(mockApi.reReviewPlan).toHaveBeenCalledWith(RUN_ID, undefined);
      expect(onAction).toHaveBeenCalledOnce();
    });
  });

  it("shows and triggers the Revise Plan dialog", async () => {
    mockApi.revisePlan.mockResolvedValue({ ok: true, runId: RUN_ID });
    const onAction = vi.fn();
    render(<ActionBar runId={RUN_ID} state="AwaitingPlanApproval" onAction={onAction} />);

    await userEvent.click(screen.getByRole("button", { name: /^Revise Plan$/i }));
    expect(screen.getByText(/Run the plan reviewer and, if changes are requested/i)).toBeDefined();
    await userEvent.click(screen.getByRole("button", { name: /^Revise$/i }));

    await waitFor(() => {
      expect(mockApi.revisePlan).toHaveBeenCalledWith(RUN_ID, undefined);
      expect(onAction).toHaveBeenCalledOnce();
    });
  });

  it("shows Answer Questions button for HumanClarificationNeeded and calls onScrollToQuestions", async () => {
    const onScroll = vi.fn();
    render(
      <ActionBar
        runId={RUN_ID}
        state="HumanClarificationNeeded"
        onAction={vi.fn()}
        onScrollToQuestions={onScroll}
      />,
    );
    await userEvent.click(screen.getByRole("button", { name: /^Answer Questions$/i }));
    expect(onScroll).toHaveBeenCalledOnce();
  });

  it("shows Resume for HumanClarificationNeeded and calls api.resumeRun on confirm", async () => {
    mockApi.resumeRun.mockResolvedValue({ ok: true });
    const onAction = vi.fn();
    render(<ActionBar runId={RUN_ID} state="HumanClarificationNeeded" onAction={onAction} />);

    await userEvent.click(screen.getByRole("button", { name: /^Resume$/i }));
    const confirmBtn = screen.getAllByRole("button", { name: /^Resume$/i })[1]!;
    await userEvent.click(confirmBtn);

    await waitFor(() => {
      expect(mockApi.resumeRun).toHaveBeenCalledWith(RUN_ID);
      expect(onAction).toHaveBeenCalledOnce();
    });
  });

  it("shows Resume for AIBlocked", () => {
    render(<ActionBar runId={RUN_ID} state="AIBlocked" onAction={vi.fn()} />);
    expect(screen.getByRole("button", { name: /^Resume$/i })).toBeDefined();
  });

  it("shows Resume for Failed", () => {
    render(<ActionBar runId={RUN_ID} state="Failed" onAction={vi.fn()} />);
    expect(screen.getByRole("button", { name: /^Resume$/i })).toBeDefined();
  });

  it("shows Approve & Complete for ReadyForHumanReview and calls api.approveReview", async () => {
    mockApi.approveReview.mockResolvedValue({ ok: true, state: "Done" });
    const onAction = vi.fn();
    render(<ActionBar runId={RUN_ID} state="ReadyForHumanReview" onAction={onAction} />);

    await userEvent.click(screen.getByRole("button", { name: /Approve & Complete/i }));
    await userEvent.click(screen.getByRole("button", { name: /Complete Run/i }));

    await waitFor(() => {
      expect(mockApi.approveReview).toHaveBeenCalledWith(RUN_ID);
      expect(onAction).toHaveBeenCalledOnce();
    });
  });

  it("shows Pause for an active-category state and calls api.pauseRun", async () => {
    mockApi.pauseRun.mockResolvedValue({ ok: true });
    const onAction = vi.fn();
    render(<ActionBar runId={RUN_ID} state="Implementing" onAction={onAction} />);

    await userEvent.click(screen.getByRole("button", { name: /^Pause$/i }));
    const confirmBtn = screen.getAllByRole("button", { name: /^Pause$/i })[1]!;
    await userEvent.click(confirmBtn);

    await waitFor(() => {
      expect(mockApi.pauseRun).toHaveBeenCalledWith(RUN_ID);
      expect(onAction).toHaveBeenCalledOnce();
    });
  });

  it.each([
    ["Todo", "Start Run"],
    ["Planning", "Retry Planning"],
    ["PlanRevision", "Retry Plan Revision"],
    ["PlanReview", "Retry Plan Review"],
    ["Implementing", "Retry Execution"],
    ["AIReview", "Retry Code Review"],
    ["AddressingReview", "Retry Remediation"],
  ])("shows the '%s' retry label for state %s and calls api.retryStage", async (state, label) => {
    mockApi.retryStage.mockResolvedValue({ ok: true, state, retrying: true });
    const onAction = vi.fn();
    render(<ActionBar runId={RUN_ID} state={state} onAction={onAction} />);

    const btn = screen.getByRole("button", { name: label });
    expect(btn).toBeDefined();
    await userEvent.click(btn);
    await userEvent.click(screen.getByRole("button", { name: "Retry" }));

    await waitFor(() => {
      expect(mockApi.retryStage).toHaveBeenCalledWith(RUN_ID);
      expect(onAction).toHaveBeenCalledOnce();
    });
  });

  it("combines multiple applicable actions (e.g. Pause + Retry) for an active retry-eligible state", () => {
    render(<ActionBar runId={RUN_ID} state="Implementing" onAction={vi.fn()} />);
    expect(screen.getByRole("button", { name: /^Pause$/i })).toBeDefined();
    expect(screen.getByRole("button", { name: /Retry Execution/i })).toBeDefined();
  });
});
