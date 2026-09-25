import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ActionBar } from "./ActionBar.tsx";
import { api } from "@/api/client.ts";

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

const RUN_ID = "run-42";

describe("ActionBar", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockApi.approvePlan.mockResolvedValue(undefined);
    mockApi.rejectPlan.mockResolvedValue(undefined);
    mockApi.reReviewPlan.mockResolvedValue(undefined);
    mockApi.revisePlan.mockResolvedValue(undefined);
    mockApi.approveReview.mockResolvedValue(undefined);
    mockApi.pauseRun.mockResolvedValue(undefined);
    mockApi.resumeRun.mockResolvedValue(undefined);
    mockApi.retryStage.mockResolvedValue(undefined);
  });

  it("renders nothing for a state with no applicable actions", () => {
    const { container } = render(
      <ActionBar runId={RUN_ID} state="Done" onAction={vi.fn()} />,
    );
    expect(container.firstChild).toBeNull();
  });

  describe("AwaitingPlanApproval state", () => {
    it("renders Approve Plan, Reject Plan, Re-review Plan and Revise Plan buttons", () => {
      render(<ActionBar runId={RUN_ID} state="AwaitingPlanApproval" onAction={vi.fn()} />);
      expect(screen.getByRole("button", { name: /^Approve Plan$/ })).toBeDefined();
      expect(screen.getByRole("button", { name: /^Reject Plan$/ })).toBeDefined();
      expect(screen.getByRole("button", { name: /Re-review Plan/ })).toBeDefined();
      expect(screen.getByRole("button", { name: /Revise Plan/ })).toBeDefined();
      // No optional-questions button unless hasOptionalQuestions is set
      expect(screen.queryByRole("button", { name: /Answer Optional Questions/ })).toBeNull();
    });

    it("shows Answer Optional Questions button when hasOptionalQuestions is true and calls onScrollToQuestions on click", async () => {
      const onScrollToQuestions = vi.fn();
      const user = userEvent.setup();
      render(
        <ActionBar
          runId={RUN_ID}
          state="AwaitingPlanApproval"
          onAction={vi.fn()}
          hasOptionalQuestions={true}
          onScrollToQuestions={onScrollToQuestions}
        />,
      );
      const btn = screen.getByRole("button", { name: /Answer Optional Questions/ });
      await user.click(btn);
      expect(onScrollToQuestions).toHaveBeenCalledOnce();
    });

    it("clicking Approve Plan opens the confirm dialog and confirming calls api.approvePlan with a note, then onAction", async () => {
      const onAction = vi.fn();
      const user = userEvent.setup();
      render(<ActionBar runId={RUN_ID} state="AwaitingPlanApproval" onAction={onAction} />);

      await user.click(screen.getByRole("button", { name: /^Approve Plan$/ }));

      // Dialog appears with the correct title/description
      expect(screen.getByText("This will approve the current plan and start implementation. The AI agent will begin coding.")).toBeDefined();

      const textarea = screen.getByPlaceholderText(/extra context, edge cases/i);
      await user.type(textarea, "watch the migration step");

      await user.click(screen.getByRole("button", { name: "Approve & Start" }));

      await waitFor(() => {
        expect(mockApi.approvePlan).toHaveBeenCalledWith(RUN_ID, "watch the migration step");
      });
      expect(onAction).toHaveBeenCalledOnce();
      // Dialog should be closed afterwards
      expect(screen.queryByRole("button", { name: "Approve & Start" })).toBeNull();
    });

    it("clicking Cancel on the Approve Plan dialog does not call the API", async () => {
      const onAction = vi.fn();
      const user = userEvent.setup();
      render(<ActionBar runId={RUN_ID} state="AwaitingPlanApproval" onAction={onAction} />);

      await user.click(screen.getByRole("button", { name: /^Approve Plan$/ }));
      await user.click(screen.getByRole("button", { name: "Cancel" }));

      expect(mockApi.approvePlan).not.toHaveBeenCalled();
      expect(onAction).not.toHaveBeenCalled();
      expect(screen.queryByRole("button", { name: "Approve & Start" })).toBeNull();
    });

    it("keeps the dialog and does not call onAction when the confirmed action rejects", async () => {
      mockApi.approvePlan.mockRejectedValue(new Error("boom"));
      const onAction = vi.fn();
      const user = userEvent.setup();
      render(<ActionBar runId={RUN_ID} state="AwaitingPlanApproval" onAction={onAction} />);

      await user.click(screen.getByRole("button", { name: /^Approve Plan$/ }));
      await user.click(screen.getByRole("button", { name: "Approve & Start" }));

      await waitFor(() => {
        expect(mockApi.approvePlan).toHaveBeenCalledOnce();
      });
      expect(onAction).not.toHaveBeenCalled();
      // Dialog closes regardless (finally block) even though the action failed
      expect(screen.queryByRole("button", { name: "Approve & Start" })).toBeNull();
    });

    it("shows a loading state on the dialog's confirm button while the action is in flight", async () => {
      let resolveAction!: () => void;
      mockApi.approvePlan.mockReturnValue(
        new Promise<void>((res) => {
          resolveAction = res;
        }),
      );
      const user = userEvent.setup();
      render(<ActionBar runId={RUN_ID} state="AwaitingPlanApproval" onAction={vi.fn()} />);

      await user.click(screen.getByRole("button", { name: /^Approve Plan$/ }));
      await user.click(screen.getByRole("button", { name: "Approve & Start" }));

      expect(screen.getByText("Working...")).toBeDefined();
      expect((screen.getByRole("button", { name: "Cancel" }) as HTMLButtonElement).disabled).toBe(
        true,
      );

      resolveAction();
      await waitFor(() => {
        expect(screen.queryByText("Working...")).toBeNull();
      });
    });

    it("clicking Re-review Plan opens its dialog and confirms via api.reReviewPlan", async () => {
      const onAction = vi.fn();
      const user = userEvent.setup();
      render(<ActionBar runId={RUN_ID} state="AwaitingPlanApproval" onAction={onAction} />);

      await user.click(screen.getByRole("button", { name: /Re-review Plan/ }));
      expect(screen.getByText("Re-review Plan", { selector: "h3" })).toBeDefined();

      await user.click(screen.getByRole("button", { name: "Re-review" }));

      await waitFor(() => {
        expect(mockApi.reReviewPlan).toHaveBeenCalledWith(RUN_ID, undefined);
      });
      expect(onAction).toHaveBeenCalledOnce();
    });

    it("clicking Revise Plan opens its dialog and confirms via api.revisePlan", async () => {
      const onAction = vi.fn();
      const user = userEvent.setup();
      render(<ActionBar runId={RUN_ID} state="AwaitingPlanApproval" onAction={onAction} />);

      await user.click(screen.getByRole("button", { name: /Revise Plan/ }));
      expect(screen.getByText("Revise Plan", { selector: "h3" })).toBeDefined();

      await user.click(screen.getByRole("button", { name: "Revise" }));

      await waitFor(() => {
        expect(mockApi.revisePlan).toHaveBeenCalledWith(RUN_ID, undefined);
      });
      expect(onAction).toHaveBeenCalledOnce();
    });

    it("clicking Reject Plan opens the custom reject dialog defaulting to iterate mode", async () => {
      const user = userEvent.setup();
      render(<ActionBar runId={RUN_ID} state="AwaitingPlanApproval" onAction={vi.fn()} />);

      await user.click(screen.getByRole("button", { name: /^Reject Plan$/ }));

      expect(
        screen.getByText("This will reject the current plan and send it back for re-planning."),
      ).toBeDefined();
      expect(screen.getByText("Revise plan")).toBeDefined();
      expect(screen.getByText("Start fresh")).toBeDefined();
    });

    it("confirms the reject dialog with default (iterate) mode and trimmed feedback", async () => {
      const onAction = vi.fn();
      const user = userEvent.setup();
      const { container } = render(
        <ActionBar runId={RUN_ID} state="AwaitingPlanApproval" onAction={onAction} />,
      );

      await user.click(screen.getByRole("button", { name: /^Reject Plan$/ }));
      const textarea = screen.getByPlaceholderText(/describe what should change/i);
      await user.type(textarea, "  needs more detail  ");

      // Both the action bar's trigger button and the dialog's confirm button
      // are labeled "Reject Plan" — scope the query to the dialog itself.
      const dialog = within(container.querySelector(".relative.z-10")!);
      await user.click(dialog.getByRole("button", { name: "Reject Plan" }));

      await waitFor(() => {
        expect(mockApi.rejectPlan).toHaveBeenCalledWith(RUN_ID, "needs more detail", "iterate");
      });
      expect(onAction).toHaveBeenCalledOnce();
    });

    it("switches to fresh mode when Start fresh is selected and submits mode='fresh'", async () => {
      const user = userEvent.setup();
      const { container } = render(
        <ActionBar runId={RUN_ID} state="AwaitingPlanApproval" onAction={vi.fn()} />,
      );

      await user.click(screen.getByRole("button", { name: /^Reject Plan$/ }));
      await user.click(screen.getByText("Start fresh"));
      const dialog = within(container.querySelector(".relative.z-10")!);
      await user.click(dialog.getByRole("button", { name: "Reject Plan" }));

      await waitFor(() => {
        expect(mockApi.rejectPlan).toHaveBeenCalledWith(RUN_ID, undefined, "fresh");
      });
    });

    it("sends undefined context when the reject feedback textarea is left empty", async () => {
      const user = userEvent.setup();
      const { container } = render(
        <ActionBar runId={RUN_ID} state="AwaitingPlanApproval" onAction={vi.fn()} />,
      );

      await user.click(screen.getByRole("button", { name: /^Reject Plan$/ }));
      const dialog = within(container.querySelector(".relative.z-10")!);
      await user.click(dialog.getByRole("button", { name: "Reject Plan" }));

      await waitFor(() => {
        expect(mockApi.rejectPlan).toHaveBeenCalledWith(RUN_ID, undefined, "iterate");
      });
    });

    it("cancelling the reject dialog does not call the API and resets state", async () => {
      const user = userEvent.setup();
      render(<ActionBar runId={RUN_ID} state="AwaitingPlanApproval" onAction={vi.fn()} />);

      await user.click(screen.getByRole("button", { name: /^Reject Plan$/ }));
      await user.type(screen.getByPlaceholderText(/describe what should change/i), "abandoned text");
      await user.click(screen.getByRole("button", { name: "Cancel" }));

      expect(mockApi.rejectPlan).not.toHaveBeenCalled();
      // Dialog is gone
      expect(screen.queryByText("Start fresh")).toBeNull();

      // Re-open to confirm the feedback textarea was reset
      await user.click(screen.getByRole("button", { name: /^Reject Plan$/ }));
      expect(
        (screen.getByPlaceholderText(/describe what should change/i) as HTMLTextAreaElement)
          .value,
      ).toBe("");
    });

    it("clicking the reject dialog's backdrop cancels it", async () => {
      const user = userEvent.setup();
      const { container } = render(
        <ActionBar runId={RUN_ID} state="AwaitingPlanApproval" onAction={vi.fn()} />,
      );

      await user.click(screen.getByRole("button", { name: /^Reject Plan$/ }));
      const overlay = container.querySelector(".absolute.inset-0.bg-black\\/60");
      expect(overlay).not.toBeNull();
      await user.click(overlay as Element);

      expect(screen.queryByText("Start fresh")).toBeNull();
    });

    it("disables the reject dialog buttons and shows Working... while the rejection is in flight", async () => {
      let resolveReject!: () => void;
      mockApi.rejectPlan.mockReturnValue(
        new Promise<void>((res) => {
          resolveReject = res;
        }),
      );
      const user = userEvent.setup();
      const { container } = render(
        <ActionBar runId={RUN_ID} state="AwaitingPlanApproval" onAction={vi.fn()} />,
      );

      await user.click(screen.getByRole("button", { name: /^Reject Plan$/ }));
      const dialog = within(container.querySelector(".relative.z-10")!);
      await user.click(dialog.getByRole("button", { name: "Reject Plan" }));

      expect(screen.getByText("Working...")).toBeDefined();
      expect((screen.getByRole("button", { name: "Cancel" }) as HTMLButtonElement).disabled).toBe(
        true,
      );

      resolveReject();
      await waitFor(() => {
        expect(screen.queryByText("Working...")).toBeNull();
      });
    });
  });

  describe("ReadyForHumanReview state", () => {
    it("renders Approve & Complete and confirms via api.approveReview with no note", async () => {
      const onAction = vi.fn();
      const user = userEvent.setup();
      render(<ActionBar runId={RUN_ID} state="ReadyForHumanReview" onAction={onAction} />);

      const openBtn = screen.getByRole("button", { name: /Approve & Complete/ });
      await user.click(openBtn);
      expect(
        screen.getByText("This will mark the run as complete. Make sure you've reviewed the PR."),
      ).toBeDefined();

      await user.click(screen.getByRole("button", { name: "Complete Run" }));

      await waitFor(() => {
        expect(mockApi.approveReview).toHaveBeenCalledWith(RUN_ID);
      });
      expect(onAction).toHaveBeenCalledOnce();
    });
  });

  describe("active/running states", () => {
    it("renders Pause and the state-specific Retry button for an active state, and confirms Pause via api.pauseRun", async () => {
      const onAction = vi.fn();
      const user = userEvent.setup();
      const { container } = render(
        <ActionBar runId={RUN_ID} state="Implementing" onAction={onAction} />,
      );

      expect(screen.getByRole("button", { name: /Pause/ })).toBeDefined();
      expect(screen.getByRole("button", { name: /Retry Execution/ })).toBeDefined();

      await user.click(screen.getByRole("button", { name: /^Pause$/ }));
      const dialog = within(container.querySelector(".relative.z-10")!);
      await user.click(dialog.getByRole("button", { name: "Pause" }));

      await waitFor(() => {
        expect(mockApi.pauseRun).toHaveBeenCalledWith(RUN_ID);
      });
      expect(onAction).toHaveBeenCalledOnce();
    });

    it("retry button uses the correct label per state and calls api.retryStage", async () => {
      const user = userEvent.setup();
      render(<ActionBar runId={RUN_ID} state="AIReview" onAction={vi.fn()} />);

      const retryBtn = screen.getByRole("button", { name: /Retry Code Review/ });
      await user.click(retryBtn);
      expect(screen.getByText("Retry Code Review", { selector: "h3" })).toBeDefined();
      expect(
        screen.getByText(/Re-run the current stage \(AIReview\)/),
      ).toBeDefined();

      await user.click(screen.getByRole("button", { name: "Retry" }));
      await waitFor(() => {
        expect(mockApi.retryStage).toHaveBeenCalledWith(RUN_ID);
      });
    });

    it("uses 'Start Run' as the retry label for the Todo state", () => {
      render(<ActionBar runId={RUN_ID} state="Todo" onAction={vi.fn()} />);
      expect(screen.getByRole("button", { name: /Start Run/ })).toBeDefined();
      // Todo is not an "active" category state, so Pause should not render
      expect(screen.queryByRole("button", { name: /^Pause$/ })).toBeNull();
    });
  });

  describe("blocked/failed/clarification states", () => {
    it("renders Resume for AIBlocked and confirms via api.resumeRun", async () => {
      const onAction = vi.fn();
      const user = userEvent.setup();
      const { container } = render(
        <ActionBar runId={RUN_ID} state="AIBlocked" onAction={onAction} />,
      );

      await user.click(screen.getByRole("button", { name: /Resume/ }));
      expect(
        screen.getByText("This will reset the run back to the start. It will begin re-planning."),
      ).toBeDefined();
      const dialog = within(container.querySelector(".relative.z-10")!);
      await user.click(dialog.getByRole("button", { name: "Resume" }));

      await waitFor(() => {
        expect(mockApi.resumeRun).toHaveBeenCalledWith(RUN_ID);
      });
      expect(onAction).toHaveBeenCalledOnce();
    });

    it("renders Resume for Failed state", () => {
      render(<ActionBar runId={RUN_ID} state="Failed" onAction={vi.fn()} />);
      expect(screen.getByRole("button", { name: /Resume/ })).toBeDefined();
    });

    it("renders Resume and Answer Questions for HumanClarificationNeeded, and Answer Questions calls onScrollToQuestions", async () => {
      const onScrollToQuestions = vi.fn();
      const user = userEvent.setup();
      render(
        <ActionBar
          runId={RUN_ID}
          state="HumanClarificationNeeded"
          onAction={vi.fn()}
          onScrollToQuestions={onScrollToQuestions}
        />,
      );

      expect(screen.getByRole("button", { name: /Resume/ })).toBeDefined();
      const answerBtn = screen.getByRole("button", { name: /^Answer Questions$/ });
      await user.click(answerBtn);
      expect(onScrollToQuestions).toHaveBeenCalledOnce();
      // api should not have been touched by this direct-action button
      expect(mockApi.resumeRun).not.toHaveBeenCalled();
    });
  });
});
