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
    for (const fn of Object.values(mockApi)) fn.mockResolvedValue({});
  });

  it("renders nothing for a state with no applicable actions", () => {
    const { container } = render(
      <ActionBar runId={RUN_ID} state="Done" onAction={vi.fn()} />,
    );
    expect(container.innerHTML).toBe("");
  });

  it("renders Approve/Reject/Re-review/Revise actions for AwaitingPlanApproval", () => {
    render(<ActionBar runId={RUN_ID} state="AwaitingPlanApproval" onAction={vi.fn()} />);
    expect(screen.getByRole("button", { name: /Approve Plan/ })).toBeDefined();
    expect(screen.getByRole("button", { name: "Reject Plan" })).toBeDefined();
    expect(screen.getByRole("button", { name: /Re-review Plan/ })).toBeDefined();
    expect(screen.getByRole("button", { name: /Revise Plan/ })).toBeDefined();
    expect(screen.queryByRole("button", { name: /Answer Optional Questions/ })).toBeNull();
  });

  it("shows the Answer Optional Questions button when hasOptionalQuestions is true", async () => {
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
    await userEvent.click(screen.getByRole("button", { name: /Answer Optional Questions/ }));
    expect(onScrollToQuestions).toHaveBeenCalledOnce();
  });

  it("shows an Answer Questions button and a Resume button for HumanClarificationNeeded", async () => {
    const onScrollToQuestions = vi.fn();
    render(
      <ActionBar
        runId={RUN_ID}
        state="HumanClarificationNeeded"
        onAction={vi.fn()}
        onScrollToQuestions={onScrollToQuestions}
      />,
    );
    expect(screen.getByRole("button", { name: /Resume/ })).toBeDefined();
    await userEvent.click(screen.getByRole("button", { name: /Answer Questions/ }));
    expect(onScrollToQuestions).toHaveBeenCalledOnce();
  });

  it("approves the plan with a note and notifies onAction", async () => {
    const onAction = vi.fn();
    render(<ActionBar runId={RUN_ID} state="AwaitingPlanApproval" onAction={onAction} />);

    await userEvent.click(screen.getByRole("button", { name: /^Approve Plan$/ }));
    expect(screen.getByRole("heading", { name: "Approve Plan" })).toBeDefined();

    const textarea = screen.getByRole("textbox");
    await userEvent.type(textarea, "watch for edge cases");
    await userEvent.click(screen.getByRole("button", { name: "Approve & Start" }));

    await waitFor(() => {
      expect(mockApi.approvePlan).toHaveBeenCalledWith(RUN_ID, "watch for edge cases");
      expect(onAction).toHaveBeenCalledOnce();
    });
    expect(screen.queryByRole("heading", { name: "Approve Plan" })).toBeNull();
  });

  it("completes a run from ReadyForHumanReview", async () => {
    const onAction = vi.fn();
    render(<ActionBar runId={RUN_ID} state="ReadyForHumanReview" onAction={onAction} />);

    await userEvent.click(screen.getByRole("button", { name: /Approve & Complete/ }));
    await userEvent.click(screen.getByRole("button", { name: "Complete Run" }));

    await waitFor(() => {
      expect(mockApi.approveReview).toHaveBeenCalledWith(RUN_ID);
      expect(onAction).toHaveBeenCalledOnce();
    });
  });

  it("shows both Pause and Retry actions for an active, retryable state and pauses the run", async () => {
    const onAction = vi.fn();
    render(<ActionBar runId={RUN_ID} state="Planning" onAction={onAction} />);

    expect(screen.getByRole("button", { name: /Pause/ })).toBeDefined();
    expect(screen.getByRole("button", { name: /Retry Planning/ })).toBeDefined();

    await userEvent.click(screen.getByRole("button", { name: /Pause/ }));
    const pauseButtons = screen.getAllByRole("button", { name: "Pause" });
    await userEvent.click(pauseButtons[pauseButtons.length - 1]);

    await waitFor(() => {
      expect(mockApi.pauseRun).toHaveBeenCalledWith(RUN_ID);
      expect(onAction).toHaveBeenCalledOnce();
    });
  });

  it("retries the current stage with a state-specific label and description", async () => {
    render(<ActionBar runId={RUN_ID} state="Implementing" onAction={vi.fn()} />);

    await userEvent.click(screen.getByRole("button", { name: /Retry Execution/ }));
    expect(screen.getByText(/\(Implementing\)/)).toBeDefined();
    await userEvent.click(screen.getByRole("button", { name: "Retry" }));

    await waitFor(() => {
      expect(mockApi.retryStage).toHaveBeenCalledWith(RUN_ID);
    });
  });

  it("shows only a Resume action (no Pause/Retry) for the Failed state and resumes the run", async () => {
    const onAction = vi.fn();
    render(<ActionBar runId={RUN_ID} state="Failed" onAction={onAction} />);

    expect(screen.queryByRole("button", { name: /Pause/ })).toBeNull();
    expect(screen.queryByRole("button", { name: /Retry/ })).toBeNull();

    await userEvent.click(screen.getByRole("button", { name: /Resume/ }));
    const resumeButtons = screen.getAllByRole("button", { name: "Resume" });
    await userEvent.click(resumeButtons[resumeButtons.length - 1]);

    await waitFor(() => {
      expect(mockApi.resumeRun).toHaveBeenCalledWith(RUN_ID);
      expect(onAction).toHaveBeenCalledOnce();
    });
  });

  it("re-reviews the plan with a note", async () => {
    render(<ActionBar runId={RUN_ID} state="AwaitingPlanApproval" onAction={vi.fn()} />);

    await userEvent.click(screen.getByRole("button", { name: /Re-review Plan/ }));
    await userEvent.type(screen.getByRole("textbox"), "focus on tests");
    await userEvent.click(screen.getByRole("button", { name: "Re-review" }));

    await waitFor(() => {
      expect(mockApi.reReviewPlan).toHaveBeenCalledWith(RUN_ID, "focus on tests");
    });
  });

  it("revises the plan with a note", async () => {
    render(<ActionBar runId={RUN_ID} state="AwaitingPlanApproval" onAction={vi.fn()} />);

    await userEvent.click(screen.getByRole("button", { name: /Revise Plan/ }));
    await userEvent.type(screen.getByRole("textbox"), "tighten rollout");
    await userEvent.click(screen.getByRole("button", { name: "Revise" }));

    await waitFor(() => {
      expect(mockApi.revisePlan).toHaveBeenCalledWith(RUN_ID, "tighten rollout");
    });
  });

  it("shows a working indicator and disables confirm while the action is pending", async () => {
    let resolveAction!: () => void;
    mockApi.approvePlan.mockReturnValue(
      new Promise<void>((res) => {
        resolveAction = res;
      }),
    );

    render(<ActionBar runId={RUN_ID} state="AwaitingPlanApproval" onAction={vi.fn()} />);
    await userEvent.click(screen.getByRole("button", { name: /^Approve Plan$/ }));
    await userEvent.click(screen.getByRole("button", { name: "Approve & Start" }));

    expect(screen.getByText("Working...")).toBeDefined();

    resolveAction();
    await waitFor(() => {
      expect(screen.queryByText("Working...")).toBeNull();
    });
  });

  it("closes the confirm dialog without calling the API when Cancel is clicked", async () => {
    render(<ActionBar runId={RUN_ID} state="AwaitingPlanApproval" onAction={vi.fn()} />);

    await userEvent.click(screen.getByRole("button", { name: /^Approve Plan$/ }));
    expect(screen.getByRole("heading", { name: "Approve Plan" })).toBeDefined();

    await userEvent.click(screen.getByRole("button", { name: "Cancel" }));

    expect(screen.queryByRole("heading", { name: "Approve Plan" })).toBeNull();
    expect(mockApi.approvePlan).not.toHaveBeenCalled();
  });

  it("closes the dialog and does not call onAction when the confirmed action rejects", async () => {
    mockApi.approvePlan.mockRejectedValue(new Error("server exploded"));
    const onAction = vi.fn();
    render(<ActionBar runId={RUN_ID} state="AwaitingPlanApproval" onAction={onAction} />);

    await userEvent.click(screen.getByRole("button", { name: /^Approve Plan$/ }));
    await userEvent.click(screen.getByRole("button", { name: "Approve & Start" }));

    await waitFor(() => {
      expect(screen.queryByRole("heading", { name: "Approve Plan" })).toBeNull();
    });
    expect(onAction).not.toHaveBeenCalled();
  });

  it("walks through the custom Reject Plan dialog: mode toggle, feedback, and submission", async () => {
    const onAction = vi.fn();
    render(<ActionBar runId={RUN_ID} state="AwaitingPlanApproval" onAction={onAction} />);

    await userEvent.click(screen.getByRole("button", { name: "Reject Plan" }));
    expect(screen.getByRole("heading", { name: "Reject Plan" })).toBeDefined();

    // Default mode is "iterate" (Revise plan)
    const iterateToggle = screen.getByText("Revise plan").closest("button")!;
    const freshToggle = screen.getByText("Start fresh").closest("button")!;
    expect(iterateToggle.className).toContain("bg-accent");
    expect(freshToggle.className).not.toContain("bg-accent");

    await userEvent.click(freshToggle);
    expect(freshToggle.className).toContain("bg-accent");

    const textarea = screen.getByPlaceholderText(/describe what should change/i);
    await userEvent.type(textarea, "please simplify step 2");

    const confirmButtons = screen.getAllByRole("button", { name: "Reject Plan" });
    await userEvent.click(confirmButtons[confirmButtons.length - 1]);

    await waitFor(() => {
      expect(mockApi.rejectPlan).toHaveBeenCalledWith(
        RUN_ID,
        "please simplify step 2",
        "fresh",
      );
      expect(onAction).toHaveBeenCalledOnce();
    });
    expect(screen.queryByRole("heading", { name: "Reject Plan" })).toBeNull();
  });

  it("cancels the Reject Plan dialog without calling the API", async () => {
    render(<ActionBar runId={RUN_ID} state="AwaitingPlanApproval" onAction={vi.fn()} />);

    await userEvent.click(screen.getByRole("button", { name: "Reject Plan" }));
    await userEvent.type(
      screen.getByPlaceholderText(/describe what should change/i),
      "some feedback",
    );
    await userEvent.click(screen.getByRole("button", { name: "Cancel" }));

    expect(screen.queryByRole("heading", { name: "Reject Plan" })).toBeNull();
    expect(mockApi.rejectPlan).not.toHaveBeenCalled();
  });

  it("closes the Reject Plan dialog without calling onAction when rejectPlan rejects", async () => {
    mockApi.rejectPlan.mockRejectedValue(new Error("linear down"));
    const onAction = vi.fn();
    render(<ActionBar runId={RUN_ID} state="AwaitingPlanApproval" onAction={onAction} />);

    await userEvent.click(screen.getByRole("button", { name: "Reject Plan" }));
    const confirmButtons = screen.getAllByRole("button", { name: "Reject Plan" });
    await userEvent.click(confirmButtons[confirmButtons.length - 1]);

    await waitFor(() => {
      expect(screen.queryByRole("heading", { name: "Reject Plan" })).toBeNull();
    });
    expect(onAction).not.toHaveBeenCalled();
  });
});
