import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

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

import { ActionBar } from "./ActionBar.tsx";
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

  it("renders Approve/Reject Plan and Re-review/Revise Plan buttons for AwaitingPlanApproval", () => {
    render(
      <ActionBar runId={RUN_ID} state="AwaitingPlanApproval" onAction={vi.fn()} />,
    );
    expect(screen.getByRole("button", { name: /Approve Plan/ })).toBeDefined();
    expect(screen.getByRole("button", { name: /Reject Plan/ })).toBeDefined();
    expect(screen.getByRole("button", { name: /Re-review Plan/ })).toBeDefined();
    expect(screen.getByRole("button", { name: /Revise Plan/ })).toBeDefined();
  });

  it("opens the confirm dialog and calls api.approvePlan with a note on confirm", async () => {
    mockApi.approvePlan.mockResolvedValue({});
    const onAction = vi.fn();
    render(
      <ActionBar runId={RUN_ID} state="AwaitingPlanApproval" onAction={onAction} />,
    );

    await userEvent.click(screen.getByRole("button", { name: /^Approve Plan$/ }));
    expect(screen.getByText("Approve & Start")).toBeDefined();

    const textarea = screen.getByRole("textbox");
    await userEvent.type(textarea, "watch the edge cases");
    await userEvent.click(screen.getByRole("button", { name: "Approve & Start" }));

    await waitFor(() => {
      expect(mockApi.approvePlan).toHaveBeenCalledWith(RUN_ID, "watch the edge cases");
      expect(onAction).toHaveBeenCalledOnce();
    });
  });

  it("opens the reject dialog, toggles mode, and calls api.rejectPlan with iterate mode by default", async () => {
    mockApi.rejectPlan.mockResolvedValue({});
    const onAction = vi.fn();
    render(
      <ActionBar runId={RUN_ID} state="AwaitingPlanApproval" onAction={onAction} />,
    );

    await userEvent.click(screen.getByRole("button", { name: /^Reject Plan$/ }));
    expect(screen.getByText("This will reject the current plan and send it back for re-planning.")).toBeDefined();

    const feedbackBox = screen.getByPlaceholderText(/describe what should change/i);
    await userEvent.type(feedbackBox, "please redo step 3");

    const rejectButtons = screen.getAllByRole("button", { name: "Reject Plan" });
    await userEvent.click(rejectButtons[rejectButtons.length - 1]);

    await waitFor(() => {
      expect(mockApi.rejectPlan).toHaveBeenCalledWith(RUN_ID, "please redo step 3", "iterate");
      expect(onAction).toHaveBeenCalledOnce();
    });
  });

  it("switches reject mode to 'fresh' and submits with fresh mode and undefined feedback when blank", async () => {
    mockApi.rejectPlan.mockResolvedValue({});
    render(
      <ActionBar runId={RUN_ID} state="AwaitingPlanApproval" onAction={vi.fn()} />,
    );

    await userEvent.click(screen.getByRole("button", { name: /^Reject Plan$/ }));
    await userEvent.click(screen.getByText("Start fresh"));
    const rejectButtons = screen.getAllByRole("button", { name: "Reject Plan" });
    await userEvent.click(rejectButtons[rejectButtons.length - 1]);

    await waitFor(() => {
      expect(mockApi.rejectPlan).toHaveBeenCalledWith(RUN_ID, undefined, "fresh");
    });
  });

  it("switches back to 'iterate' mode after selecting 'fresh', and submits with iterate mode", async () => {
    mockApi.rejectPlan.mockResolvedValue({});
    render(
      <ActionBar runId={RUN_ID} state="AwaitingPlanApproval" onAction={vi.fn()} />,
    );

    await userEvent.click(screen.getByRole("button", { name: /^Reject Plan$/ }));
    await userEvent.click(screen.getByText("Start fresh"));
    await userEvent.click(screen.getByText("Revise plan"));

    const rejectButtons = screen.getAllByRole("button", { name: "Reject Plan" });
    await userEvent.click(rejectButtons[rejectButtons.length - 1]);

    await waitFor(() => {
      expect(mockApi.rejectPlan).toHaveBeenCalledWith(RUN_ID, undefined, "iterate");
    });
  });

  it("cancels the reject dialog via the Cancel button without calling the API", async () => {
    render(
      <ActionBar runId={RUN_ID} state="AwaitingPlanApproval" onAction={vi.fn()} />,
    );

    await userEvent.click(screen.getByRole("button", { name: /^Reject Plan$/ }));
    const feedbackBox = screen.getByPlaceholderText(/describe what should change/i);
    await userEvent.type(feedbackBox, "some feedback");

    await userEvent.click(screen.getByRole("button", { name: "Cancel" }));

    expect(screen.queryByPlaceholderText(/describe what should change/i)).toBeNull();
    expect(mockApi.rejectPlan).not.toHaveBeenCalled();
  });

  it("cancels the reject dialog via the backdrop click", async () => {
    const { container } = render(
      <ActionBar runId={RUN_ID} state="AwaitingPlanApproval" onAction={vi.fn()} />,
    );

    await userEvent.click(screen.getByRole("button", { name: /^Reject Plan$/ }));
    const backdrop = container.querySelector(".absolute.inset-0") as HTMLElement;
    await userEvent.click(backdrop);

    expect(screen.queryByPlaceholderText(/describe what should change/i)).toBeNull();
  });

  it("opens the Re-review dialog with the right copy and calls api.reReviewPlan", async () => {
    mockApi.reReviewPlan.mockResolvedValue({});
    render(
      <ActionBar runId={RUN_ID} state="AwaitingPlanApproval" onAction={vi.fn()} />,
    );

    await userEvent.click(screen.getByRole("button", { name: "Re-review Plan" }));
    expect(screen.getByText("Re-review Plan", { selector: "h3" })).toBeDefined();

    await userEvent.click(screen.getByRole("button", { name: "Re-review" }));

    await waitFor(() => {
      expect(mockApi.reReviewPlan).toHaveBeenCalledWith(RUN_ID, undefined);
    });
  });

  it("opens the Revise Plan dialog and calls api.revisePlan", async () => {
    mockApi.revisePlan.mockResolvedValue({});
    render(
      <ActionBar runId={RUN_ID} state="AwaitingPlanApproval" onAction={vi.fn()} />,
    );

    await userEvent.click(screen.getByRole("button", { name: "Revise Plan" }));
    await userEvent.click(screen.getByRole("button", { name: "Revise" }));

    await waitFor(() => {
      expect(mockApi.revisePlan).toHaveBeenCalledWith(RUN_ID, undefined);
    });
  });

  it("renders Answer Questions button for HumanClarificationNeeded and triggers onScrollToQuestions", async () => {
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
    expect(onScroll).toHaveBeenCalledOnce();
  });

  it("renders Resume button for HumanClarificationNeeded and calls api.resumeRun on confirm", async () => {
    mockApi.resumeRun.mockResolvedValue({});
    render(
      <ActionBar runId={RUN_ID} state="HumanClarificationNeeded" onAction={vi.fn()} />,
    );
    await userEvent.click(screen.getByRole("button", { name: "Resume" }));
    const resumeButtons = screen.getAllByRole("button", { name: "Resume" });
    await userEvent.click(resumeButtons[resumeButtons.length - 1]);

    await waitFor(() => {
      expect(mockApi.resumeRun).toHaveBeenCalledWith(RUN_ID);
    });
  });

  it("renders the Answer Optional Questions button when AwaitingPlanApproval has optional questions", () => {
    render(
      <ActionBar
        runId={RUN_ID}
        state="AwaitingPlanApproval"
        onAction={vi.fn()}
        hasOptionalQuestions={true}
        onScrollToQuestions={vi.fn()}
      />,
    );
    expect(screen.getByRole("button", { name: /Answer Optional Questions/ })).toBeDefined();
  });

  it("does not render the Answer Optional Questions button when hasOptionalQuestions is false", () => {
    render(
      <ActionBar
        runId={RUN_ID}
        state="AwaitingPlanApproval"
        onAction={vi.fn()}
        hasOptionalQuestions={false}
      />,
    );
    expect(screen.queryByRole("button", { name: /Answer Optional Questions/ })).toBeNull();
  });

  it("renders Approve & Complete for ReadyForHumanReview and calls api.approveReview", async () => {
    mockApi.approveReview.mockResolvedValue({});
    const onAction = vi.fn();
    render(
      <ActionBar runId={RUN_ID} state="ReadyForHumanReview" onAction={onAction} />,
    );
    await userEvent.click(screen.getByRole("button", { name: "Approve & Complete" }));
    await userEvent.click(screen.getByRole("button", { name: "Complete Run" }));

    await waitFor(() => {
      expect(mockApi.approveReview).toHaveBeenCalledWith(RUN_ID);
      expect(onAction).toHaveBeenCalledOnce();
    });
  });

  it("renders Pause for an active-category state and calls api.pauseRun", async () => {
    mockApi.pauseRun.mockResolvedValue({});
    render(<ActionBar runId={RUN_ID} state="Implementing" onAction={vi.fn()} />);

    await userEvent.click(screen.getByRole("button", { name: "Pause" }));
    const pauseButtons = screen.getAllByRole("button", { name: "Pause" });
    await userEvent.click(pauseButtons[pauseButtons.length - 1]);

    await waitFor(() => {
      expect(mockApi.pauseRun).toHaveBeenCalledWith(RUN_ID);
    });
  });

  it("renders Resume for AIBlocked and Failed states", () => {
    const { rerender } = render(
      <ActionBar runId={RUN_ID} state="AIBlocked" onAction={vi.fn()} />,
    );
    expect(screen.getByRole("button", { name: "Resume" })).toBeDefined();

    rerender(<ActionBar runId={RUN_ID} state="Failed" onAction={vi.fn()} />);
    expect(screen.getByRole("button", { name: "Resume" })).toBeDefined();
  });

  it("renders the correct retry label per state and calls api.retryStage", async () => {
    mockApi.retryStage.mockResolvedValue({});
    const onAction = vi.fn();
    render(<ActionBar runId={RUN_ID} state="Planning" onAction={onAction} />);

    const retryBtn = screen.getByRole("button", { name: "Retry Planning" });
    await userEvent.click(retryBtn);
    expect(screen.getByText("Re-run the current stage (Planning). The agent will pick up from where it left off using existing artifacts.")).toBeDefined();

    await userEvent.click(screen.getByRole("button", { name: "Retry" }));

    await waitFor(() => {
      expect(mockApi.retryStage).toHaveBeenCalledWith(RUN_ID);
      expect(onAction).toHaveBeenCalledOnce();
    });
  });

  it("uses 'Start Run' retry label for the Todo state", () => {
    render(<ActionBar runId={RUN_ID} state="Todo" onAction={vi.fn()} />);
    expect(screen.getByRole("button", { name: "Start Run" })).toBeDefined();
  });

  it("swallows a rejected confirm action and still closes the dialog", async () => {
    mockApi.approvePlan.mockRejectedValue(new Error("network down"));
    const onAction = vi.fn();
    render(
      <ActionBar runId={RUN_ID} state="AwaitingPlanApproval" onAction={onAction} />,
    );

    await userEvent.click(screen.getByRole("button", { name: /^Approve Plan$/ }));
    await userEvent.click(screen.getByRole("button", { name: "Approve & Start" }));

    await waitFor(() => {
      expect(mockApi.approvePlan).toHaveBeenCalledOnce();
    });
    // Dialog should be closed (no longer showing notes textarea) and onAction
    // was not invoked because the action rejected.
    await waitFor(() => {
      expect(screen.queryByRole("textbox")).toBeNull();
    });
    expect(onAction).not.toHaveBeenCalled();
  });

  it("swallows a rejected reject-plan action and still resets the reject dialog state", async () => {
    mockApi.rejectPlan.mockRejectedValue(new Error("network down"));
    render(
      <ActionBar runId={RUN_ID} state="AwaitingPlanApproval" onAction={vi.fn()} />,
    );

    await userEvent.click(screen.getByRole("button", { name: /^Reject Plan$/ }));
    const rejectButtons = screen.getAllByRole("button", { name: "Reject Plan" });
    await userEvent.click(rejectButtons[rejectButtons.length - 1]);

    await waitFor(() => {
      expect(mockApi.rejectPlan).toHaveBeenCalledOnce();
    });
    await waitFor(() => {
      expect(screen.queryByPlaceholderText(/describe what should change/i)).toBeNull();
    });
  });

  it("cancels a generic confirm dialog via Cancel without invoking the action", async () => {
    render(<ActionBar runId={RUN_ID} state="Implementing" onAction={vi.fn()} />);

    await userEvent.click(screen.getByRole("button", { name: "Pause" }));
    await userEvent.click(screen.getByRole("button", { name: "Cancel" }));

    expect(screen.queryByText("Pause Run")).toBeNull();
    expect(mockApi.pauseRun).not.toHaveBeenCalled();
  });
});
