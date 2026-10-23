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

describe("ActionBar gaps", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("opens the Re-review Plan dialog, submits a note, and calls api.reReviewPlan", async () => {
    mockApi.reReviewPlan.mockResolvedValue({ ok: true, runId: "run-1" });
    const onAction = vi.fn();
    render(<ActionBar runId="run-1" state="AwaitingPlanApproval" onAction={onAction} />);

    await userEvent.click(screen.getByRole("button", { name: /Re-review Plan/ }));

    const confirmBtn = await screen.findByRole("button", { name: "Re-review" });
    const textarea = screen.getByPlaceholderText(/focus on the test plan/i);
    await userEvent.type(textarea, "double check the migration step");
    await userEvent.click(confirmBtn);

    await waitFor(() => {
      expect(mockApi.reReviewPlan).toHaveBeenCalledWith("run-1", "double check the migration step");
      expect(onAction).toHaveBeenCalledOnce();
    });
  });

  it("opens the Revise Plan dialog and calls api.revisePlan with no note when confirmed empty", async () => {
    mockApi.revisePlan.mockResolvedValue({ ok: true, runId: "run-2" });
    const onAction = vi.fn();
    render(<ActionBar runId="run-2" state="AwaitingPlanApproval" onAction={onAction} />);

    await userEvent.click(screen.getByRole("button", { name: /Revise Plan/ }));

    const confirmBtn = await screen.findByRole("button", { name: "Revise" });
    await userEvent.click(confirmBtn);

    await waitFor(() => {
      expect(mockApi.revisePlan).toHaveBeenCalledWith("run-2", undefined);
      expect(onAction).toHaveBeenCalledOnce();
    });
  });

  it("confirms the Approve & Complete dialog and calls api.approveReview", async () => {
    mockApi.approveReview.mockResolvedValue({ ok: true, state: "Done" });
    const onAction = vi.fn();
    render(<ActionBar runId="run-done" state="ReadyForHumanReview" onAction={onAction} />);

    await userEvent.click(screen.getByRole("button", { name: /Approve & Complete/ }));
    const confirmBtn = await screen.findByRole("button", { name: "Complete Run" });
    await userEvent.click(confirmBtn);

    await waitFor(() => {
      expect(mockApi.approveReview).toHaveBeenCalledWith("run-done");
      expect(onAction).toHaveBeenCalledOnce();
    });
  });

  it("confirms the Pause dialog and calls api.pauseRun", async () => {
    mockApi.pauseRun.mockResolvedValue({ ok: true });
    const onAction = vi.fn();
    render(<ActionBar runId="run-3" state="Implementing" onAction={onAction} />);

    await userEvent.click(screen.getByRole("button", { name: /Pause/ }));
    // Two "Pause" buttons exist now: the toolbar trigger and the dialog's
    // own confirm button (rendered after it in the DOM).
    const pauseButtons = await screen.findAllByRole("button", { name: "Pause" });
    await userEvent.click(pauseButtons[pauseButtons.length - 1]);

    await waitFor(() => {
      expect(mockApi.pauseRun).toHaveBeenCalledWith("run-3");
      expect(onAction).toHaveBeenCalledOnce();
    });
  });

  it("confirms the Resume dialog and calls api.resumeRun", async () => {
    mockApi.resumeRun.mockResolvedValue({ ok: true });
    const onAction = vi.fn();
    render(<ActionBar runId="run-4" state="AIBlocked" onAction={onAction} />);

    await userEvent.click(screen.getByRole("button", { name: /Resume/ }));
    const resumeButtons = await screen.findAllByRole("button", { name: "Resume" });
    await userEvent.click(resumeButtons[resumeButtons.length - 1]);

    await waitFor(() => {
      expect(mockApi.resumeRun).toHaveBeenCalledWith("run-4");
      expect(onAction).toHaveBeenCalledOnce();
    });
  });

  it("confirms the state-specific retry dialog and calls api.retryStage", async () => {
    mockApi.retryStage.mockResolvedValue({ ok: true, state: "Planning", retrying: true });
    const onAction = vi.fn();
    render(<ActionBar runId="run-5" state="Planning" onAction={onAction} />);

    await userEvent.click(screen.getByRole("button", { name: /Retry Planning/ }));
    const confirmBtn = await screen.findByRole("button", { name: "Retry" });
    await userEvent.click(confirmBtn);

    await waitFor(() => {
      expect(mockApi.retryStage).toHaveBeenCalledWith("run-5");
      expect(onAction).toHaveBeenCalledOnce();
    });
  });

  it("toggles the reject dialog back to 'iterate' mode after selecting 'fresh', reflecting the active style", async () => {
    render(<ActionBar runId="run-6" state="AwaitingPlanApproval" onAction={vi.fn()} />);

    await userEvent.click(screen.getByRole("button", { name: /Reject Plan/ }));
    await userEvent.click(screen.getByText("Start fresh"));

    const reviseLabel = screen.getByText("Revise plan");
    const iterateButton = reviseLabel.closest("button") as HTMLButtonElement;
    const freshLabel = screen.getByText("Start fresh");
    const freshButton = freshLabel.closest("button") as HTMLButtonElement;

    expect(freshButton.className).toContain("bg-accent");
    expect(iterateButton.className).not.toContain("bg-accent");

    await userEvent.click(iterateButton);

    expect(iterateButton.className).toContain("bg-accent");
    expect(freshButton.className).not.toContain("bg-accent");
  });

  it("closes the reject dialog via the Cancel button without calling api.rejectPlan", async () => {
    render(<ActionBar runId="run-7" state="AwaitingPlanApproval" onAction={vi.fn()} />);

    await userEvent.click(screen.getByRole("button", { name: /Reject Plan/ }));
    const feedbackBox = await screen.findByPlaceholderText(/describe what should change/i);
    await userEvent.type(feedbackBox, "some feedback that should be discarded");

    await userEvent.click(screen.getByRole("button", { name: "Cancel" }));

    expect(mockApi.rejectPlan).not.toHaveBeenCalled();
    expect(screen.queryByPlaceholderText(/describe what should change/i)).toBeNull();
  });
});
