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

const mockApi = api as unknown as Record<string, ReturnType<typeof vi.fn>>;
const RUN_ID = "run-1";

// The custom reject dialog's confirm button shares its label ("Reject Plan")
// with the action bar's trigger button; the dialog is rendered later in the
// DOM, so its confirm button is always the last match.
function lastRejectConfirmButton(): HTMLElement {
  const all = screen.getAllByRole("button", { name: /^reject plan$/i });
  return all[all.length - 1];
}

describe("ActionBar", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    Object.values(mockApi).forEach((fn) => fn.mockResolvedValue({ ok: true }));
  });

  it("renders nothing for a state with no available actions", () => {
    const { container } = render(
      <ActionBar runId={RUN_ID} state="Done" onAction={vi.fn()} />,
    );
    expect(container.firstChild).toBeNull();
  });

  it("Todo state shows Start Run button which opens a confirm dialog and calls retryStage", async () => {
    const onAction = vi.fn();
    render(<ActionBar runId={RUN_ID} state="Todo" onAction={onAction} />);

    const startBtn = screen.getByRole("button", { name: /start run/i });
    await userEvent.click(startBtn);

    expect(screen.getByText("Start Run", { selector: "h3" })).toBeDefined();
    await userEvent.click(screen.getByRole("button", { name: "Retry" }));

    await waitFor(() => {
      expect(mockApi.retryStage).toHaveBeenCalledWith(RUN_ID);
      expect(onAction).toHaveBeenCalledOnce();
    });
  });

  it("mid-run active+retryable state (Planning) shows both Retry and Pause actions", async () => {
    render(<ActionBar runId={RUN_ID} state="Planning" onAction={vi.fn()} />);
    expect(screen.getByRole("button", { name: /retry planning/i })).toBeDefined();
    expect(screen.getByRole("button", { name: /pause/i })).toBeDefined();
  });

  it("Pause action calls api.pauseRun and onAction on confirm", async () => {
    const onAction = vi.fn();
    render(<ActionBar runId={RUN_ID} state="Implementing" onAction={onAction} />);

    await userEvent.click(screen.getByRole("button", { name: /^pause$/i }));
    // Two "Pause" buttons now exist: the bar trigger and the dialog's confirm
    // button — the confirm button is the one rendered last.
    const pauseButtons = screen.getAllByRole("button", { name: "Pause" });
    await userEvent.click(pauseButtons[pauseButtons.length - 1]);

    await waitFor(() => {
      expect(mockApi.pauseRun).toHaveBeenCalledWith(RUN_ID);
      expect(onAction).toHaveBeenCalledOnce();
    });
  });

  it("AwaitingPlanApproval shows Approve, Reject, Re-review and Revise actions", () => {
    render(<ActionBar runId={RUN_ID} state="AwaitingPlanApproval" onAction={vi.fn()} />);
    expect(screen.getByRole("button", { name: /approve plan/i })).toBeDefined();
    expect(screen.getByRole("button", { name: /reject plan/i })).toBeDefined();
    expect(screen.getByRole("button", { name: /re-review plan/i })).toBeDefined();
    expect(screen.getByRole("button", { name: /revise plan/i })).toBeDefined();
  });

  it("shows Answer Optional Questions button when hasOptionalQuestions is true, and calls onScrollToQuestions", async () => {
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
    const btn = screen.getByRole("button", { name: /answer optional questions/i });
    await userEvent.click(btn);
    expect(onScrollToQuestions).toHaveBeenCalledOnce();
  });

  it("does not show Answer Optional Questions button when hasOptionalQuestions is false", () => {
    render(<ActionBar runId={RUN_ID} state="AwaitingPlanApproval" onAction={vi.fn()} />);
    expect(screen.queryByRole("button", { name: /answer optional questions/i })).toBeNull();
  });

  it("Approve Plan opens dialog with notes field; confirming with a note calls approvePlan with note", async () => {
    const onAction = vi.fn();
    render(<ActionBar runId={RUN_ID} state="AwaitingPlanApproval" onAction={onAction} />);

    await userEvent.click(screen.getByRole("button", { name: /^approve plan$/i }));
    expect(screen.getByText("Approve Plan", { selector: "h3" })).toBeDefined();

    const textarea = screen.getByRole("textbox");
    await userEvent.type(textarea, "watch for edge cases");
    await userEvent.click(screen.getByRole("button", { name: /approve & start/i }));

    await waitFor(() => {
      expect(mockApi.approvePlan).toHaveBeenCalledWith(RUN_ID, "watch for edge cases");
      expect(onAction).toHaveBeenCalledOnce();
    });
  });

  it("Re-review Plan dialog confirms and calls reReviewPlan", async () => {
    const onAction = vi.fn();
    render(<ActionBar runId={RUN_ID} state="AwaitingPlanApproval" onAction={onAction} />);

    await userEvent.click(screen.getByRole("button", { name: /re-review plan/i }));
    expect(screen.getByText("Re-review Plan", { selector: "h3" })).toBeDefined();
    await userEvent.click(screen.getByRole("button", { name: /^re-review$/i }));

    await waitFor(() => {
      expect(mockApi.reReviewPlan).toHaveBeenCalledWith(RUN_ID, undefined);
      expect(onAction).toHaveBeenCalledOnce();
    });
  });

  it("Revise Plan dialog confirms and calls revisePlan", async () => {
    const onAction = vi.fn();
    render(<ActionBar runId={RUN_ID} state="AwaitingPlanApproval" onAction={onAction} />);

    await userEvent.click(screen.getByRole("button", { name: /revise plan/i }));
    expect(screen.getByText("Revise Plan", { selector: "h3" })).toBeDefined();
    await userEvent.click(screen.getByRole("button", { name: /^revise$/i }));

    await waitFor(() => {
      expect(mockApi.revisePlan).toHaveBeenCalledWith(RUN_ID, undefined);
      expect(onAction).toHaveBeenCalledOnce();
    });
  });

  it("Cancelling a confirm dialog does not call the underlying api action", async () => {
    render(<ActionBar runId={RUN_ID} state="AwaitingPlanApproval" onAction={vi.fn()} />);

    await userEvent.click(screen.getByRole("button", { name: /^approve plan$/i }));
    await userEvent.click(screen.getByRole("button", { name: "Cancel" }));

    expect(mockApi.approvePlan).not.toHaveBeenCalled();
    expect(screen.queryByText("Approve Plan", { selector: "h3" })).toBeNull();
  });

  it("shows Working... spinner while the confirm action is pending, then clears it", async () => {
    let resolveFn!: (v: unknown) => void;
    mockApi.approvePlan.mockReturnValue(new Promise((res) => (resolveFn = res)));

    render(<ActionBar runId={RUN_ID} state="AwaitingPlanApproval" onAction={vi.fn()} />);
    await userEvent.click(screen.getByRole("button", { name: /^approve plan$/i }));
    await userEvent.click(screen.getByRole("button", { name: /approve & start/i }));

    expect(screen.getByText("Working...")).toBeDefined();
    resolveFn({ ok: true });

    await waitFor(() => {
      expect(screen.queryByText("Working...")).toBeNull();
    });
  });

  it("swallows a failed confirm action without calling onAction, and closes the dialog", async () => {
    mockApi.approvePlan.mockRejectedValue(new Error("boom"));
    const onAction = vi.fn();

    render(<ActionBar runId={RUN_ID} state="AwaitingPlanApproval" onAction={onAction} />);
    await userEvent.click(screen.getByRole("button", { name: /^approve plan$/i }));
    await userEvent.click(screen.getByRole("button", { name: /approve & start/i }));

    await waitFor(() => {
      expect(screen.queryByText("Approve Plan", { selector: "h3" })).toBeNull();
    });
    expect(onAction).not.toHaveBeenCalled();
  });

  it("Reject Plan opens a custom dialog defaulting to iterate mode", async () => {
    render(<ActionBar runId={RUN_ID} state="AwaitingPlanApproval" onAction={vi.fn()} />);
    await userEvent.click(screen.getByRole("button", { name: /^reject plan$/i }));

    expect(screen.getByText("Revise plan")).toBeDefined();
    expect(screen.getByText("Start fresh")).toBeDefined();
    expect(screen.getByPlaceholderText(/describe what should change/i)).toBeDefined();
  });

  it("Reject Plan confirm sends trimmed feedback and iterate mode by default", async () => {
    const onAction = vi.fn();
    render(<ActionBar runId={RUN_ID} state="AwaitingPlanApproval" onAction={onAction} />);

    await userEvent.click(screen.getByRole("button", { name: /^reject plan$/i }));
    const textarea = screen.getByPlaceholderText(/describe what should change/i);
    await userEvent.type(textarea, "  needs more detail  ");

    await userEvent.click(lastRejectConfirmButton());

    await waitFor(() => {
      expect(mockApi.rejectPlan).toHaveBeenCalledWith(RUN_ID, "needs more detail", "iterate");
      expect(onAction).toHaveBeenCalledOnce();
    });
  });

  it("Reject Plan confirm sends undefined context when feedback left blank, and can switch to fresh mode", async () => {
    render(<ActionBar runId={RUN_ID} state="AwaitingPlanApproval" onAction={vi.fn()} />);

    await userEvent.click(screen.getByRole("button", { name: /^reject plan$/i }));
    await userEvent.click(screen.getByText("Start fresh"));
    await userEvent.click(lastRejectConfirmButton());

    await waitFor(() => {
      expect(mockApi.rejectPlan).toHaveBeenCalledWith(RUN_ID, undefined, "fresh");
    });
  });

  it("Reject Plan cancel button closes the dialog without calling the api", async () => {
    render(<ActionBar runId={RUN_ID} state="AwaitingPlanApproval" onAction={vi.fn()} />);
    await userEvent.click(screen.getByRole("button", { name: /^reject plan$/i }));
    await userEvent.click(screen.getByRole("button", { name: "Cancel" }));

    expect(mockApi.rejectPlan).not.toHaveBeenCalled();
    expect(screen.queryByText("Revise plan")).toBeNull();
  });

  it("Reject Plan backdrop click closes the dialog", async () => {
    const { container } = render(
      <ActionBar runId={RUN_ID} state="AwaitingPlanApproval" onAction={vi.fn()} />,
    );
    await userEvent.click(screen.getByRole("button", { name: /^reject plan$/i }));
    const overlay = container.querySelector(".absolute.inset-0");
    await userEvent.click(overlay as Element);

    expect(screen.queryByText("Revise plan")).toBeNull();
  });

  it("Reject Plan shows Working... spinner while pending and swallows a rejection error", async () => {
    let rejectFn!: (e: unknown) => void;
    mockApi.rejectPlan.mockReturnValue(
      new Promise((_, rej) => {
        rejectFn = rej;
      }),
    );
    const onAction = vi.fn();

    render(<ActionBar runId={RUN_ID} state="AwaitingPlanApproval" onAction={onAction} />);
    await userEvent.click(screen.getByRole("button", { name: /^reject plan$/i }));
    await userEvent.click(lastRejectConfirmButton());

    expect(screen.getByText("Working...")).toBeDefined();
    rejectFn(new Error("nope"));

    await waitFor(() => {
      expect(screen.queryByText("Working...")).toBeNull();
    });
    expect(onAction).not.toHaveBeenCalled();
  });

  it("ReadyForHumanReview shows Approve & Complete which calls approveReview", async () => {
    const onAction = vi.fn();
    render(<ActionBar runId={RUN_ID} state="ReadyForHumanReview" onAction={onAction} />);

    await userEvent.click(screen.getByRole("button", { name: /approve & complete/i }));
    await userEvent.click(screen.getByRole("button", { name: /complete run/i }));

    await waitFor(() => {
      expect(mockApi.approveReview).toHaveBeenCalledWith(RUN_ID);
      expect(onAction).toHaveBeenCalledOnce();
    });
  });

  it("HumanClarificationNeeded shows Answer Questions (direct) and Resume (dialog) actions", async () => {
    const onScrollToQuestions = vi.fn();
    const onAction = vi.fn();
    render(
      <ActionBar
        runId={RUN_ID}
        state="HumanClarificationNeeded"
        onAction={onAction}
        onScrollToQuestions={onScrollToQuestions}
      />,
    );

    await userEvent.click(screen.getByRole("button", { name: /^answer questions$/i }));
    expect(onScrollToQuestions).toHaveBeenCalledOnce();

    await userEvent.click(screen.getByRole("button", { name: /^resume$/i }));
    const resumeButtons = screen.getAllByRole("button", { name: /^resume$/i });
    await userEvent.click(resumeButtons[resumeButtons.length - 1]);

    await waitFor(() => {
      expect(mockApi.resumeRun).toHaveBeenCalledWith(RUN_ID);
      expect(onAction).toHaveBeenCalledOnce();
    });
  });

  it("AIBlocked and Failed states show a Resume action without Answer Questions", () => {
    const { unmount } = render(
      <ActionBar runId={RUN_ID} state="AIBlocked" onAction={vi.fn()} />,
    );
    expect(screen.getByRole("button", { name: /resume/i })).toBeDefined();
    expect(screen.queryByRole("button", { name: /answer questions/i })).toBeNull();
    unmount();

    render(<ActionBar runId={RUN_ID} state="Failed" onAction={vi.fn()} />);
    expect(screen.getByRole("button", { name: /resume/i })).toBeDefined();
    expect(screen.queryByRole("button", { name: /retry/i })).toBeNull();
  });
});
