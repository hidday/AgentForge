import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
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
      mockApi[key].mockResolvedValue({ ok: true });
    }
  });

  it("renders nothing for a state with no applicable actions", () => {
    const { container } = render(
      <ActionBar runId="run-1" state="Done" onAction={vi.fn()} />,
    );
    expect(container.firstChild).toBeNull();
  });

  describe("AwaitingPlanApproval", () => {
    it("renders Approve/Reject/Re-review/Revise buttons", () => {
      render(
        <ActionBar runId="run-1" state="AwaitingPlanApproval" onAction={vi.fn()} />,
      );
      expect(screen.getByRole("button", { name: /Approve Plan/i })).toBeDefined();
      expect(screen.getByRole("button", { name: /Reject Plan/i })).toBeDefined();
      expect(screen.getByRole("button", { name: /Re-review Plan/i })).toBeDefined();
      expect(screen.getByRole("button", { name: /Revise Plan/i })).toBeDefined();
    });

    it("renders the Answer Optional Questions button only when hasOptionalQuestions is true", () => {
      const { rerender } = render(
        <ActionBar runId="run-1" state="AwaitingPlanApproval" onAction={vi.fn()} />,
      );
      expect(screen.queryByText("Answer Optional Questions")).toBeNull();

      rerender(
        <ActionBar
          runId="run-1"
          state="AwaitingPlanApproval"
          onAction={vi.fn()}
          hasOptionalQuestions
          onScrollToQuestions={vi.fn()}
        />,
      );
      expect(screen.getByText("Answer Optional Questions")).toBeDefined();
    });

    it("calls onScrollToQuestions when Answer Optional Questions is clicked", async () => {
      const onScrollToQuestions = vi.fn();
      render(
        <ActionBar
          runId="run-1"
          state="AwaitingPlanApproval"
          onAction={vi.fn()}
          hasOptionalQuestions
          onScrollToQuestions={onScrollToQuestions}
        />,
      );
      await userEvent.click(screen.getByText("Answer Optional Questions"));
      expect(onScrollToQuestions).toHaveBeenCalledOnce();
    });

    it("approves the plan with a note via the confirm dialog", async () => {
      const onAction = vi.fn();
      render(
        <ActionBar runId="run-1" state="AwaitingPlanApproval" onAction={onAction} />,
      );

      await userEvent.click(screen.getByRole("button", { name: /Approve Plan/i }));
      expect(screen.getByText(/This will approve the current plan/i)).toBeDefined();

      const textarea = screen.getByRole("textbox");
      await userEvent.type(textarea, "go ahead");
      await userEvent.click(screen.getByRole("button", { name: "Approve & Start" }));

      await waitFor(() => {
        expect(mockApi.approvePlan).toHaveBeenCalledWith("run-1", "go ahead");
        expect(onAction).toHaveBeenCalledOnce();
      });
    });

    it("opens the re-review dialog and calls api.reReviewPlan on confirm", async () => {
      const onAction = vi.fn();
      render(
        <ActionBar runId="run-1" state="AwaitingPlanApproval" onAction={onAction} />,
      );

      await userEvent.click(screen.getByRole("button", { name: /Re-review Plan/i }));
      expect(
        screen.getByText(/Run the plan reviewer again against the current plan/i),
      ).toBeDefined();
      await userEvent.click(screen.getByRole("button", { name: "Re-review" }));

      await waitFor(() => {
        expect(mockApi.reReviewPlan).toHaveBeenCalledWith("run-1", undefined);
        expect(onAction).toHaveBeenCalledOnce();
      });
    });

    it("opens the revise dialog and calls api.revisePlan on confirm", async () => {
      const onAction = vi.fn();
      render(
        <ActionBar runId="run-1" state="AwaitingPlanApproval" onAction={onAction} />,
      );

      await userEvent.click(screen.getByRole("button", { name: /Revise Plan/i }));
      await userEvent.click(screen.getByRole("button", { name: "Revise" }));

      await waitFor(() => {
        expect(mockApi.revisePlan).toHaveBeenCalledWith("run-1", undefined);
        expect(onAction).toHaveBeenCalledOnce();
      });
    });

    it("opens the custom reject dialog instead of the generic confirm dialog", async () => {
      render(
        <ActionBar runId="run-1" state="AwaitingPlanApproval" onAction={vi.fn()} />,
      );

      await userEvent.click(screen.getByRole("button", { name: /Reject Plan/i }));
      expect(
        screen.getByText("This will reject the current plan and send it back for re-planning."),
      ).toBeDefined();
      expect(screen.getByText("Revise plan")).toBeDefined();
      expect(screen.getByText("Start fresh")).toBeDefined();
    });

    it("rejects the plan in default (iterate) mode with feedback", async () => {
      const onAction = vi.fn();
      render(
        <ActionBar runId="run-1" state="AwaitingPlanApproval" onAction={onAction} />,
      );

      await userEvent.click(screen.getByRole("button", { name: /Reject Plan/i }));
      const textarea = screen.getByPlaceholderText(
        "Optional: describe what should change in the next plan...",
      );
      await userEvent.type(textarea, "please fix X");

      const confirmButtons = screen.getAllByRole("button", { name: "Reject Plan" });
      await userEvent.click(confirmButtons[confirmButtons.length - 1]);

      await waitFor(() => {
        expect(mockApi.rejectPlan).toHaveBeenCalledWith("run-1", "please fix X", "iterate");
        expect(onAction).toHaveBeenCalledOnce();
      });
    });

    it("rejects the plan in 'fresh' mode when selected", async () => {
      const onAction = vi.fn();
      render(
        <ActionBar runId="run-1" state="AwaitingPlanApproval" onAction={onAction} />,
      );

      await userEvent.click(screen.getByRole("button", { name: /Reject Plan/i }));
      await userEvent.click(screen.getByText("Start fresh"));

      const confirmButtons = screen.getAllByRole("button", { name: "Reject Plan" });
      await userEvent.click(confirmButtons[confirmButtons.length - 1]);

      await waitFor(() => {
        expect(mockApi.rejectPlan).toHaveBeenCalledWith("run-1", undefined, "fresh");
        expect(onAction).toHaveBeenCalledOnce();
      });
    });

    it("switches back to 'iterate' mode after selecting 'fresh'", async () => {
      const onAction = vi.fn();
      render(
        <ActionBar runId="run-1" state="AwaitingPlanApproval" onAction={onAction} />,
      );

      await userEvent.click(screen.getByRole("button", { name: /Reject Plan/i }));
      await userEvent.click(screen.getByText("Start fresh"));
      await userEvent.click(screen.getByText("Revise plan"));

      const confirmButtons = screen.getAllByRole("button", { name: "Reject Plan" });
      await userEvent.click(confirmButtons[confirmButtons.length - 1]);

      await waitFor(() => {
        expect(mockApi.rejectPlan).toHaveBeenCalledWith("run-1", undefined, "iterate");
      });
    });

    it("cancels the reject dialog without calling the API", async () => {
      render(
        <ActionBar runId="run-1" state="AwaitingPlanApproval" onAction={vi.fn()} />,
      );

      await userEvent.click(screen.getByRole("button", { name: /Reject Plan/i }));
      const textarea = screen.getByPlaceholderText(
        "Optional: describe what should change in the next plan...",
      );
      await userEvent.type(textarea, "some feedback");

      await userEvent.click(screen.getByRole("button", { name: "Cancel" }));

      expect(mockApi.rejectPlan).not.toHaveBeenCalled();
      expect(
        screen.queryByText("This will reject the current plan and send it back for re-planning."),
      ).toBeNull();
    });

    it("dismisses the reject dialog by clicking the backdrop", async () => {
      const { container } = render(
        <ActionBar runId="run-1" state="AwaitingPlanApproval" onAction={vi.fn()} />,
      );

      await userEvent.click(screen.getByRole("button", { name: /Reject Plan/i }));
      const backdrop = container.querySelector(".absolute.inset-0.bg-black\\/60");
      expect(backdrop).not.toBeNull();
      await userEvent.click(backdrop as Element);

      expect(
        screen.queryByText("This will reject the current plan and send it back for re-planning."),
      ).toBeNull();
    });
  });

  describe("ReadyForHumanReview", () => {
    it("renders Approve & Complete and calls api.approveReview with no note", async () => {
      const onAction = vi.fn();
      render(
        <ActionBar runId="run-1" state="ReadyForHumanReview" onAction={onAction} />,
      );

      await userEvent.click(screen.getByRole("button", { name: /Approve & Complete/i }));
      await userEvent.click(screen.getByRole("button", { name: "Complete Run" }));

      await waitFor(() => {
        expect(mockApi.approveReview).toHaveBeenCalledWith("run-1");
        expect(onAction).toHaveBeenCalledOnce();
      });
    });
  });

  describe("active states (Pause + Retry)", () => {
    it("renders Pause and the stage-specific retry label, and pauses on confirm", async () => {
      const onAction = vi.fn();
      render(<ActionBar runId="run-1" state="Implementing" onAction={onAction} />);

      expect(screen.getByRole("button", { name: /Retry Execution/i })).toBeDefined();

      await userEvent.click(screen.getByRole("button", { name: /Pause/i }));
      const pauseButtons = screen.getAllByRole("button", { name: "Pause" });
      await userEvent.click(pauseButtons[pauseButtons.length - 1]);

      await waitFor(() => {
        expect(mockApi.pauseRun).toHaveBeenCalledWith("run-1");
        expect(onAction).toHaveBeenCalledOnce();
      });
    });

    it("retries the current stage on confirm", async () => {
      const onAction = vi.fn();
      render(<ActionBar runId="run-1" state="Implementing" onAction={onAction} />);

      await userEvent.click(screen.getByRole("button", { name: /Retry Execution/i }));
      expect(screen.getByText(/Re-run the current stage \(Implementing\)/)).toBeDefined();
      await userEvent.click(screen.getByRole("button", { name: "Retry" }));

      await waitFor(() => {
        expect(mockApi.retryStage).toHaveBeenCalledWith("run-1");
        expect(onAction).toHaveBeenCalledOnce();
      });
    });

    it("uses the Todo-specific 'Start Run' retry label", () => {
      render(<ActionBar runId="run-1" state="Todo" onAction={vi.fn()} />);
      expect(screen.getByRole("button", { name: "Start Run" })).toBeDefined();
    });
  });

  describe("Resume states", () => {
    it.each(["AIBlocked", "HumanClarificationNeeded", "Failed"])(
      "renders Resume for %s and resumes the run on confirm",
      async (state) => {
        const onAction = vi.fn();
        render(<ActionBar runId="run-1" state={state} onAction={onAction} />);

        await userEvent.click(screen.getByRole("button", { name: /Resume/i }));
        const resumeButtons = screen.getAllByRole("button", { name: "Resume" });
        await userEvent.click(resumeButtons[resumeButtons.length - 1]);

        await waitFor(() => {
          expect(mockApi.resumeRun).toHaveBeenCalledWith("run-1");
          expect(onAction).toHaveBeenCalledOnce();
        });
      },
    );

    it("shows the Answer Questions button for HumanClarificationNeeded and calls onScrollToQuestions", async () => {
      const onScrollToQuestions = vi.fn();
      render(
        <ActionBar
          runId="run-1"
          state="HumanClarificationNeeded"
          onAction={vi.fn()}
          onScrollToQuestions={onScrollToQuestions}
        />,
      );
      const btn = screen.getByText("Answer Questions");
      await userEvent.click(btn);
      expect(onScrollToQuestions).toHaveBeenCalledOnce();
    });

    it("does not show the Answer Questions button for AIBlocked", () => {
      render(<ActionBar runId="run-1" state="AIBlocked" onAction={vi.fn()} />);
      expect(screen.queryByText("Answer Questions")).toBeNull();
    });
  });

  it("closes the dialog without calling onAction when the action rejects", async () => {
    mockApi.pauseRun.mockRejectedValueOnce(new Error("boom"));
    const onAction = vi.fn();
    render(<ActionBar runId="run-1" state="Implementing" onAction={onAction} />);

    await userEvent.click(screen.getByRole("button", { name: /Pause/i }));
    const pauseButtons = screen.getAllByRole("button", { name: "Pause" });
    await userEvent.click(pauseButtons[pauseButtons.length - 1]);

    await waitFor(() => {
      expect(mockApi.pauseRun).toHaveBeenCalledOnce();
    });
    expect(onAction).not.toHaveBeenCalled();
    expect(screen.queryByText("This will pause the run. You can resume it later.")).toBeNull();
  });

  it("dismisses the generic confirm dialog via Cancel without calling the API", async () => {
    render(<ActionBar runId="run-1" state="Implementing" onAction={vi.fn()} />);

    await userEvent.click(screen.getByRole("button", { name: /Pause/i }));
    await userEvent.click(screen.getByRole("button", { name: "Cancel" }));

    expect(mockApi.pauseRun).not.toHaveBeenCalled();
    expect(screen.queryByText("This will pause the run. You can resume it later.")).toBeNull();
  });
});
