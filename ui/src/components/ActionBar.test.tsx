import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
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

import { api } from "@/api/client.ts";
import { ActionBar } from "./ActionBar.tsx";

const mockApi = api as unknown as Record<string, ReturnType<typeof vi.fn>>;

function setup(state: string, extra: Partial<React.ComponentProps<typeof ActionBar>> = {}) {
  const onAction = vi.fn();
  const onScrollToQuestions = vi.fn();
  const utils = render(
    <ActionBar
      runId="run-42"
      state={state}
      onAction={onAction}
      onScrollToQuestions={onScrollToQuestions}
      {...extra}
    />,
  );
  return { ...utils, onAction, onScrollToQuestions };
}

function toolbarButtons() {
  return Array.from(document.querySelectorAll(".sticky button")).map((b) => b.textContent);
}

beforeEach(() => {
  for (const fn of Object.values(mockApi)) fn.mockReset().mockResolvedValue({ ok: true });
});

describe("ActionBar visibility", () => {
  it("renders nothing for Done", () => {
    const { container } = setup("Done");
    expect(container.innerHTML).toBe("");
  });

  it("shows plan-approval actions for AwaitingPlanApproval", () => {
    setup("AwaitingPlanApproval");
    expect(toolbarButtons()).toEqual(["Re-review Plan", "Revise Plan", "Approve Plan", "Reject Plan"]);
  });

  it("adds Answer Optional Questions when optional questions exist", async () => {
    const { onScrollToQuestions } = setup("AwaitingPlanApproval", { hasOptionalQuestions: true });
    await userEvent.click(screen.getByRole("button", { name: "Answer Optional Questions" }));
    expect(onScrollToQuestions).toHaveBeenCalledTimes(1);
  });

  it("shows Answer Questions and Resume for HumanClarificationNeeded", async () => {
    const { onScrollToQuestions } = setup("HumanClarificationNeeded");
    expect(toolbarButtons()).toEqual(["Answer Questions", "Resume"]);
    await userEvent.click(screen.getByRole("button", { name: "Answer Questions" }));
    expect(onScrollToQuestions).toHaveBeenCalledTimes(1);
  });

  it.each([
    ["Todo", ["Start Run"]],
    ["Planning", ["Pause", "Retry Planning"]],
    ["PlanReview", ["Pause", "Retry Plan Review"]],
    ["PlanRevision", ["Pause", "Retry Plan Revision"]],
    ["Implementing", ["Pause", "Retry Execution"]],
    ["AIReview", ["Pause", "Retry Code Review"]],
    ["AddressingReview", ["Pause", "Retry Remediation"]],
    ["ReadyForHumanReview", ["Approve & Complete"]],
    ["AIBlocked", ["Resume"]],
    ["Failed", ["Resume"]],
  ])("state %s shows %j", (state, expected) => {
    setup(state);
    expect(toolbarButtons()).toEqual(expected);
  });
});

describe("ActionBar confirm-dialog actions", () => {
  it.each([
    ["ReadyForHumanReview", "Approve & Complete", "Complete Run", "approveReview"],
    ["Implementing", "Pause", "Pause", "pauseRun"],
    ["AIBlocked", "Resume", "Resume", "resumeRun"],
    ["Implementing", "Retry Execution", "Retry", "retryStage"],
  ])("%s: %s confirms via %s and calls api.%s", async (state, button, confirm, method) => {
    const { onAction } = setup(state);
    fireEvent.click(screen.getByRole("button", { name: button }));
    const dialogConfirm = screen.getAllByRole("button", { name: confirm }).at(-1)!;
    await userEvent.click(dialogConfirm);
    await waitFor(() => expect(onAction).toHaveBeenCalledTimes(1));
    expect(mockApi[method]).toHaveBeenCalledWith("run-42");
    expect(screen.queryByRole("heading", { level: 3 })).toBeNull();
  });

  it("includes the current state in the retry description", () => {
    setup("AIReview");
    fireEvent.click(screen.getByRole("button", { name: "Retry Code Review" }));
    expect(screen.getByText(/Re-run the current stage \(AIReview\)/)).toBeTruthy();
  });

  it("approves the plan forwarding the executor note", async () => {
    const { onAction } = setup("AwaitingPlanApproval");
    fireEvent.click(screen.getByRole("button", { name: "Approve Plan" }));
    expect(screen.getByText("Notes for the executor (optional)")).toBeTruthy();
    await userEvent.type(screen.getByRole("textbox"), "watch the migration");
    await userEvent.click(screen.getByRole("button", { name: "Approve & Start" }));
    await waitFor(() => expect(onAction).toHaveBeenCalled());
    expect(mockApi.approvePlan).toHaveBeenCalledWith("run-42", "watch the migration");
  });

  it("re-reviews and revises the plan with notes", async () => {
    setup("AwaitingPlanApproval");
    fireEvent.click(screen.getByRole("button", { name: "Re-review Plan" }));
    expect(screen.getByText("Notes for the plan reviewer (optional)")).toBeTruthy();
    await userEvent.click(screen.getByRole("button", { name: "Re-review" }));
    await waitFor(() => expect(mockApi.reReviewPlan).toHaveBeenCalledWith("run-42", undefined));

    fireEvent.click(screen.getByRole("button", { name: "Revise Plan" }));
    expect(screen.getByText("Notes for the plan reviser (optional)")).toBeTruthy();
    await userEvent.type(screen.getByRole("textbox"), "expand tests");
    await userEvent.click(screen.getByRole("button", { name: "Revise" }));
    await waitFor(() => expect(mockApi.revisePlan).toHaveBeenCalledWith("run-42", "expand tests"));
  });

  it("does not call onAction when the API fails, and closes the dialog", async () => {
    mockApi.pauseRun!.mockRejectedValue(new Error("nope"));
    const { onAction } = setup("Planning");
    fireEvent.click(screen.getByRole("button", { name: "Pause" }));
    expect(screen.getByText("Pause Run")).toBeTruthy();
    await userEvent.click(screen.getAllByRole("button", { name: "Pause" }).at(-1)!);
    await waitFor(() => expect(screen.queryByText("Pause Run")).toBeNull());
    expect(onAction).not.toHaveBeenCalled();
  });

  it("shows a loading state while the action is in flight", async () => {
    let resolve!: (v: unknown) => void;
    mockApi.resumeRun!.mockReturnValue(new Promise((r) => (resolve = r)));
    const { onAction } = setup("AIBlocked");
    fireEvent.click(screen.getByRole("button", { name: "Resume" }));
    fireEvent.click(screen.getAllByRole("button", { name: "Resume" }).at(-1)!);
    expect(await screen.findByText("Working...")).toBeTruthy();
    resolve({ ok: true });
    await waitFor(() => expect(onAction).toHaveBeenCalled());
    expect(screen.queryByText("Working...")).toBeNull();
  });

  it("cancels the confirm dialog without calling the API", () => {
    const { onAction } = setup("ReadyForHumanReview");
    fireEvent.click(screen.getByRole("button", { name: "Approve & Complete" }));
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(screen.queryByText("Complete Run")).toBeNull();
    expect(mockApi.approveReview).not.toHaveBeenCalled();
    expect(onAction).not.toHaveBeenCalled();
  });
});

describe("ActionBar reject dialog", () => {
  function openReject() {
    fireEvent.click(screen.getByRole("button", { name: "Reject Plan" }));
    expect(screen.getByRole("heading", { name: "Reject Plan" })).toBeTruthy();
  }
  const confirmReject = () =>
    screen.getAllByRole("button", { name: "Reject Plan" }).at(-1)!;

  it("rejects in iterate mode by default with trimmed feedback", async () => {
    const { onAction } = setup("AwaitingPlanApproval");
    openReject();
    expect(screen.getByRole("button", { name: /Revise plan/ }).className).toContain("bg-accent");
    await userEvent.type(screen.getByPlaceholderText(/describe what should change/), "  more tests  ");
    await userEvent.click(confirmReject());
    await waitFor(() => expect(onAction).toHaveBeenCalled());
    expect(mockApi.rejectPlan).toHaveBeenCalledWith("run-42", "more tests", "iterate");
    expect(screen.queryByRole("heading", { name: "Reject Plan" })).toBeNull();
  });

  it("rejects in fresh mode with no feedback, then resets mode for the next open", async () => {
    setup("AwaitingPlanApproval");
    openReject();
    await userEvent.click(screen.getByRole("button", { name: /Start fresh/ }));
    expect(screen.getByRole("button", { name: /Start fresh/ }).className).toContain("bg-accent");
    expect(screen.getByRole("button", { name: /Revise plan/ }).className).not.toContain("bg-accent");
    await userEvent.click(screen.getByRole("button", { name: /Revise plan/ }));
    await userEvent.click(screen.getByRole("button", { name: /Start fresh/ }));
    await userEvent.click(confirmReject());
    await waitFor(() => expect(mockApi.rejectPlan).toHaveBeenCalledWith("run-42", undefined, "fresh"));

    openReject();
    expect(screen.getByRole("button", { name: /Revise plan/ }).className).toContain("bg-accent");
  });

  it("cancel resets feedback and mode without calling the API", async () => {
    setup("AwaitingPlanApproval");
    openReject();
    await userEvent.type(screen.getByPlaceholderText(/describe what should change/), "draft");
    await userEvent.click(screen.getByRole("button", { name: /Start fresh/ }));
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(screen.queryByRole("heading", { name: "Reject Plan" })).toBeNull();
    openReject();
    expect((screen.getByPlaceholderText(/describe what should change/) as HTMLTextAreaElement).value).toBe("");
    expect(screen.getByRole("button", { name: /Revise plan/ }).className).toContain("bg-accent");
    expect(mockApi.rejectPlan).not.toHaveBeenCalled();
  });

  it("closes when the backdrop is clicked", () => {
    setup("AwaitingPlanApproval");
    openReject();
    const backdrops = document.querySelectorAll(".backdrop-blur-sm.absolute");
    fireEvent.click(backdrops[backdrops.length - 1]!);
    expect(screen.queryByRole("heading", { name: "Reject Plan" })).toBeNull();
  });

  it("closes without onAction when the API fails, and shows loading meanwhile", async () => {
    let reject!: (e: unknown) => void;
    mockApi.rejectPlan!.mockReturnValue(new Promise((_r, j) => (reject = j)));
    const { onAction } = setup("AwaitingPlanApproval");
    openReject();
    fireEvent.click(confirmReject());
    expect(await screen.findByText("Working...")).toBeTruthy();
    expect((screen.getByRole("button", { name: "Cancel" }) as HTMLButtonElement).disabled).toBe(true);
    reject(new Error("fail"));
    await waitFor(() => expect(screen.queryByRole("heading", { name: "Reject Plan" })).toBeNull());
    expect(onAction).not.toHaveBeenCalled();
  });
});
