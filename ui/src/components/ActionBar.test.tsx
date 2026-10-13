import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, within, waitFor } from "@testing-library/react";
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

// This file exercises many dialogs with multiple user interactions each; give
// each test extra headroom under load rather than racing the default timeout.
vi.setConfig({ testTimeout: 15000 });

function resolveAll() {
  mockApi.approvePlan.mockResolvedValue({ ok: true, state: "Implementing" });
  mockApi.rejectPlan.mockResolvedValue({ ok: true, state: "Planning" });
  mockApi.reReviewPlan.mockResolvedValue({ ok: true, runId: RUN_ID });
  mockApi.revisePlan.mockResolvedValue({ ok: true, runId: RUN_ID });
  mockApi.approveReview.mockResolvedValue({ ok: true, state: "Done" });
  mockApi.pauseRun.mockResolvedValue({ ok: true });
  mockApi.resumeRun.mockResolvedValue({ ok: true });
  mockApi.retryStage.mockResolvedValue({ ok: true, state: "Planning", retrying: true });
}

describe("ActionBar", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resolveAll();
  });

  it("renders nothing for a state with no applicable actions", () => {
    const { container } = render(
      <ActionBar runId={RUN_ID} state="Done" onAction={vi.fn()} />,
    );
    expect(container.firstChild).toBeNull();
  });

  it("renders nothing for an unrecognized state", () => {
    const { container } = render(
      <ActionBar runId={RUN_ID} state="SomeUnknownState" onAction={vi.fn()} />,
    );
    expect(container.firstChild).toBeNull();
  });

  it("shows a 'Start Run' retry action for Todo state with no Pause button", () => {
    render(<ActionBar runId={RUN_ID} state="Todo" onAction={vi.fn()} />);
    expect(screen.getByRole("button", { name: /Start Run/i })).toBeDefined();
    expect(screen.queryByRole("button", { name: /Pause/i })).toBeNull();
  });

  it("shows both Pause and a stage-specific retry action for an active state", () => {
    render(<ActionBar runId={RUN_ID} state="Implementing" onAction={vi.fn()} />);
    expect(screen.getByRole("button", { name: /Pause/i })).toBeDefined();
    expect(screen.getByRole("button", { name: /Retry Execution/i })).toBeDefined();
  });

  it.each([
    ["Planning", "Retry Planning"],
    ["PlanRevision", "Retry Plan Revision"],
    ["PlanReview", "Retry Plan Review"],
    ["AIReview", "Retry Code Review"],
    ["AddressingReview", "Retry Remediation"],
  ])("shows the correct retry label for %s", (state, label) => {
    render(<ActionBar runId={RUN_ID} state={state} onAction={vi.fn()} />);
    expect(screen.getByRole("button", { name: label })).toBeDefined();
  });

  it("calls api.retryStage and onAction when confirming a retry action", async () => {
    const onAction = vi.fn();
    render(<ActionBar runId={RUN_ID} state="Implementing" onAction={onAction} />);

    await userEvent.click(screen.getByRole("button", { name: /Retry Execution/i }));
    expect(screen.getByRole("heading", { name: "Retry Execution" })).toBeDefined();
    expect(
      screen.getByText(/Re-run the current stage \(Implementing\)/i),
    ).toBeDefined();

    await userEvent.click(screen.getByRole("button", { name: "Retry" }));

    await waitFor(() => {
      expect(mockApi.retryStage).toHaveBeenCalledWith(RUN_ID);
      expect(onAction).toHaveBeenCalledOnce();
    });
  });

  it("calls api.pauseRun when confirming the Pause action", async () => {
    const onAction = vi.fn();
    render(<ActionBar runId={RUN_ID} state="Implementing" onAction={onAction} />);

    await userEvent.click(screen.getByRole("button", { name: /Pause/i }));
    const dialog = screen.getByRole("heading", { name: "Pause Run" }).closest("div")!
      .parentElement!;
    await userEvent.click(within(dialog).getByRole("button", { name: "Pause" }));

    await waitFor(() => {
      expect(mockApi.pauseRun).toHaveBeenCalledWith(RUN_ID);
      expect(onAction).toHaveBeenCalledOnce();
    });
  });

  it("cancelling the confirm dialog does not call the API or onAction", async () => {
    const onAction = vi.fn();
    render(<ActionBar runId={RUN_ID} state="Implementing" onAction={onAction} />);

    await userEvent.click(screen.getByRole("button", { name: /Pause/i }));
    const dialog = screen.getByRole("heading", { name: "Pause Run" }).closest("div")!
      .parentElement!;

    await userEvent.click(within(dialog).getByRole("button", { name: "Cancel" }));

    expect(screen.queryByText("Pause Run")).toBeNull();
    expect(mockApi.pauseRun).not.toHaveBeenCalled();
    expect(onAction).not.toHaveBeenCalled();
  });

  it("shows a Resume action for AIBlocked and calls api.resumeRun on confirm", async () => {
    const onAction = vi.fn();
    render(<ActionBar runId={RUN_ID} state="AIBlocked" onAction={onAction} />);

    expect(screen.queryByRole("button", { name: /Pause/i })).toBeNull();
    await userEvent.click(screen.getByRole("button", { name: /Resume/i }));
    const dialog = screen.getByRole("heading", { name: "Resume Run" }).closest("div")!
      .parentElement!;
    await userEvent.click(within(dialog).getByRole("button", { name: "Resume" }));

    await waitFor(() => {
      expect(mockApi.resumeRun).toHaveBeenCalledWith(RUN_ID);
      expect(onAction).toHaveBeenCalledOnce();
    });
  });

  it("shows a Resume action for Failed state", () => {
    render(<ActionBar runId={RUN_ID} state="Failed" onAction={vi.fn()} />);
    expect(screen.getByRole("button", { name: /Resume/i })).toBeDefined();
  });

  it("shows both Answer Questions and Resume for HumanClarificationNeeded, calling onScrollToQuestions", async () => {
    const onScrollToQuestions = vi.fn();
    render(
      <ActionBar
        runId={RUN_ID}
        state="HumanClarificationNeeded"
        onAction={vi.fn()}
        onScrollToQuestions={onScrollToQuestions}
      />,
    );

    expect(screen.getByRole("button", { name: /Resume/i })).toBeDefined();
    const answerBtn = screen.getByRole("button", { name: /Answer Questions/i });
    await userEvent.click(answerBtn);
    expect(onScrollToQuestions).toHaveBeenCalledOnce();
  });

  it("shows Approve & Complete for ReadyForHumanReview and calls api.approveReview with no note field", async () => {
    const onAction = vi.fn();
    render(<ActionBar runId={RUN_ID} state="ReadyForHumanReview" onAction={onAction} />);

    await userEvent.click(screen.getByRole("button", { name: /Approve & Complete/i }));
    expect(screen.getByRole("heading", { name: "Approve & Complete" })).toBeDefined();
    // This dialog has no `notes` config, so no textarea is rendered
    expect(screen.queryByRole("textbox")).toBeNull();

    await userEvent.click(screen.getByRole("button", { name: "Complete Run" }));

    await waitFor(() => {
      expect(mockApi.approveReview).toHaveBeenCalledWith(RUN_ID);
      expect(onAction).toHaveBeenCalledOnce();
    });
  });

  describe("AwaitingPlanApproval", () => {
    it("shows Approve Plan, Reject Plan, Re-review Plan and Revise Plan actions", () => {
      render(
        <ActionBar runId={RUN_ID} state="AwaitingPlanApproval" onAction={vi.fn()} />,
      );

      expect(screen.getByRole("button", { name: /Approve Plan/i })).toBeDefined();
      expect(screen.getByRole("button", { name: /^Reject Plan$/i })).toBeDefined();
      expect(screen.getByRole("button", { name: /Re-review Plan/i })).toBeDefined();
      expect(screen.getByRole("button", { name: /Revise Plan/i })).toBeDefined();
      expect(screen.queryByRole("button", { name: /Answer Optional Questions/i })).toBeNull();
    });

    it("shows the Answer Optional Questions button only when hasOptionalQuestions is true", async () => {
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

      const btn = screen.getByRole("button", { name: /Answer Optional Questions/i });
      await userEvent.click(btn);
      expect(onScrollToQuestions).toHaveBeenCalledOnce();
    });

    it("calls api.approvePlan with a trimmed note and onAction on confirm", async () => {
      const onAction = vi.fn();
      render(
        <ActionBar runId={RUN_ID} state="AwaitingPlanApproval" onAction={onAction} />,
      );

      await userEvent.click(screen.getByRole("button", { name: /Approve Plan/i }));
      const textarea = screen.getByPlaceholderText(/extra context/i);
      await userEvent.type(textarea, "  watch the auth flow  ");
      await userEvent.click(screen.getByRole("button", { name: "Approve & Start" }));

      await waitFor(() => {
        expect(mockApi.approvePlan).toHaveBeenCalledWith(RUN_ID, "watch the auth flow");
        expect(onAction).toHaveBeenCalledOnce();
      });
    });

    it("calls api.approvePlan with undefined note when left blank", async () => {
      const onAction = vi.fn();
      render(
        <ActionBar runId={RUN_ID} state="AwaitingPlanApproval" onAction={onAction} />,
      );

      await userEvent.click(screen.getByRole("button", { name: /Approve Plan/i }));
      await userEvent.click(screen.getByRole("button", { name: "Approve & Start" }));

      await waitFor(() => {
        expect(mockApi.approvePlan).toHaveBeenCalledWith(RUN_ID, undefined);
        expect(onAction).toHaveBeenCalledOnce();
      });
    });

    it("does not call onAction when the confirmed action rejects", async () => {
      const onAction = vi.fn();
      mockApi.approvePlan.mockRejectedValue(new Error("boom"));

      render(
        <ActionBar runId={RUN_ID} state="AwaitingPlanApproval" onAction={onAction} />,
      );

      await userEvent.click(screen.getByRole("button", { name: /Approve Plan/i }));
      await userEvent.click(screen.getByRole("button", { name: "Approve & Start" }));

      await waitFor(() => {
        expect(mockApi.approvePlan).toHaveBeenCalledOnce();
      });
      expect(onAction).not.toHaveBeenCalled();
      // dialog closes regardless of failure
      expect(screen.queryByText("Approve & Start")).toBeNull();
    });

    it("shows the loading state while an action is pending and disables the dialog buttons", async () => {
      let resolveAction!: (v: unknown) => void;
      mockApi.approvePlan.mockReturnValue(
        new Promise((res) => {
          resolveAction = res;
        }),
      );
      render(
        <ActionBar runId={RUN_ID} state="AwaitingPlanApproval" onAction={vi.fn()} />,
      );

      await userEvent.click(screen.getByRole("button", { name: /Approve Plan/i }));
      await userEvent.click(screen.getByRole("button", { name: "Approve & Start" }));

      expect(screen.getByText("Working...")).toBeDefined();
      expect((screen.getByRole("button", { name: "Cancel" }) as HTMLButtonElement).disabled).toBe(
        true,
      );

      resolveAction({ ok: true });
      await waitFor(() => {
        expect(screen.queryByText("Working...")).toBeNull();
      });
    });

    it("calls api.reReviewPlan with the note on confirm", async () => {
      const onAction = vi.fn();
      render(
        <ActionBar runId={RUN_ID} state="AwaitingPlanApproval" onAction={onAction} />,
      );

      await userEvent.click(screen.getByRole("button", { name: /Re-review Plan/i }));
      expect(screen.getByRole("heading", { name: "Re-review Plan" })).toBeDefined();
      const textarea = screen.getByPlaceholderText(/focus on the test plan/i);
      await userEvent.type(textarea, "check rollback plan");
      await userEvent.click(screen.getByRole("button", { name: "Re-review" }));

      await waitFor(() => {
        expect(mockApi.reReviewPlan).toHaveBeenCalledWith(RUN_ID, "check rollback plan");
        expect(onAction).toHaveBeenCalledOnce();
      });
    });

    it("calls api.revisePlan with the note on confirm", async () => {
      const onAction = vi.fn();
      render(
        <ActionBar runId={RUN_ID} state="AwaitingPlanApproval" onAction={onAction} />,
      );

      await userEvent.click(screen.getByRole("button", { name: /Revise Plan/i }));
      expect(screen.getByRole("heading", { name: "Revise Plan" })).toBeDefined();
      const textarea = screen.getByPlaceholderText(/tighten the rollout step/i);
      await userEvent.type(textarea, "tighten step 3");
      await userEvent.click(screen.getByRole("button", { name: "Revise" }));

      await waitFor(() => {
        expect(mockApi.revisePlan).toHaveBeenCalledWith(RUN_ID, "tighten step 3");
        expect(onAction).toHaveBeenCalledOnce();
      });
    });

    it("opens a custom Reject Plan dialog distinct from ConfirmDialog", async () => {
      render(
        <ActionBar runId={RUN_ID} state="AwaitingPlanApproval" onAction={vi.fn()} />,
      );

      const actionBtns = screen.getAllByRole("button", { name: /^Reject Plan$/i });
      expect(actionBtns.length).toBe(1);
      await userEvent.click(actionBtns[0]);

      expect(
        screen.getByText(/This will reject the current plan and send it back/i),
      ).toBeDefined();
      expect(screen.getByText("Revise plan")).toBeDefined();
      expect(screen.getByText("Start fresh")).toBeDefined();
    });

    it("defaults reject mode to iterate and calls api.rejectPlan with trimmed feedback and mode", async () => {
      const onAction = vi.fn();
      render(
        <ActionBar runId={RUN_ID} state="AwaitingPlanApproval" onAction={onAction} />,
      );

      await userEvent.click(screen.getAllByRole("button", { name: /^Reject Plan$/i })[0]);

      const dialogHeading = screen.getByText(
        /This will reject the current plan and send it back/i,
      );
      const dialog = dialogHeading.closest("div")!.parentElement!;

      const textarea = within(dialog).getByPlaceholderText(
        /describe what should change/i,
      );
      await userEvent.type(textarea, "  please add rollback steps  ");

      const confirmBtn = within(dialog).getByRole("button", { name: "Reject Plan" });
      await userEvent.click(confirmBtn);

      await waitFor(() => {
        expect(mockApi.rejectPlan).toHaveBeenCalledWith(
          RUN_ID,
          "please add rollback steps",
          "iterate",
        );
        expect(onAction).toHaveBeenCalledOnce();
      });
    });

    it("switches to fresh mode and calls api.rejectPlan with mode 'fresh' and undefined feedback when left blank", async () => {
      const onAction = vi.fn();
      render(
        <ActionBar runId={RUN_ID} state="AwaitingPlanApproval" onAction={onAction} />,
      );

      await userEvent.click(screen.getAllByRole("button", { name: /^Reject Plan$/i })[0]);
      await userEvent.click(screen.getByText("Start fresh"));

      const dialogHeading = screen.getByText(
        /This will reject the current plan and send it back/i,
      );
      const dialog = dialogHeading.closest("div")!.parentElement!;
      const confirmBtn = within(dialog).getByRole("button", { name: "Reject Plan" });
      await userEvent.click(confirmBtn);

      await waitFor(() => {
        expect(mockApi.rejectPlan).toHaveBeenCalledWith(RUN_ID, undefined, "fresh");
        expect(onAction).toHaveBeenCalledOnce();
      });
    });

    it("shows a loading state in the reject dialog while rejecting is pending", async () => {
      let resolveReject!: (v: unknown) => void;
      mockApi.rejectPlan.mockReturnValue(
        new Promise((res) => {
          resolveReject = res;
        }),
      );
      render(
        <ActionBar runId={RUN_ID} state="AwaitingPlanApproval" onAction={vi.fn()} />,
      );

      await userEvent.click(screen.getAllByRole("button", { name: /^Reject Plan$/i })[0]);
      const dialogHeading = screen.getByText(
        /This will reject the current plan and send it back/i,
      );
      const dialog = dialogHeading.closest("div")!.parentElement!;
      await userEvent.click(within(dialog).getByRole("button", { name: "Reject Plan" }));

      expect(within(dialog).getByText("Working...")).toBeDefined();
      expect(
        (within(dialog).getByRole("button", { name: "Cancel" }) as HTMLButtonElement).disabled,
      ).toBe(true);

      resolveReject({ ok: true });
      await waitFor(() => {
        expect(screen.queryByText(/This will reject the current plan/i)).toBeNull();
      });
    });

    it("cancelling the reject dialog closes it without calling the API", async () => {
      render(
        <ActionBar runId={RUN_ID} state="AwaitingPlanApproval" onAction={vi.fn()} />,
      );

      await userEvent.click(screen.getAllByRole("button", { name: /^Reject Plan$/i })[0]);
      const dialogHeading = screen.getByText(
        /This will reject the current plan and send it back/i,
      );
      const dialog = dialogHeading.closest("div")!.parentElement!;
      await userEvent.click(within(dialog).getByRole("button", { name: "Cancel" }));

      expect(screen.queryByText(/This will reject the current plan/i)).toBeNull();
      expect(mockApi.rejectPlan).not.toHaveBeenCalled();
    });

    it("resets reject mode and feedback after a reject is confirmed, so reopening starts fresh", async () => {
      render(
        <ActionBar runId={RUN_ID} state="AwaitingPlanApproval" onAction={vi.fn()} />,
      );

      await userEvent.click(screen.getAllByRole("button", { name: /^Reject Plan$/i })[0]);
      let dialogHeading = screen.getByText(
        /This will reject the current plan and send it back/i,
      );
      let dialog = dialogHeading.closest("div")!.parentElement!;
      await userEvent.click(within(dialog).getByText("Start fresh"));
      const textarea = within(dialog).getByPlaceholderText(/describe what should change/i);
      await userEvent.type(textarea, "some feedback");
      await userEvent.click(within(dialog).getByRole("button", { name: "Reject Plan" }));

      await waitFor(() => {
        expect(mockApi.rejectPlan).toHaveBeenCalledWith(RUN_ID, "some feedback", "fresh");
      });

      // Reopen: should be back to defaults (iterate mode, empty feedback)
      await userEvent.click(screen.getAllByRole("button", { name: /^Reject Plan$/i })[0]);
      dialogHeading = screen.getByText(
        /This will reject the current plan and send it back/i,
      );
      dialog = dialogHeading.closest("div")!.parentElement!;
      const newTextarea = within(dialog).getByPlaceholderText(
        /describe what should change/i,
      ) as HTMLTextAreaElement;
      expect(newTextarea.value).toBe("");
    });
  });
});
