import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import type { Run } from "@/api/client.ts";
import { RunsTable } from "./RunsTable.tsx";

vi.mock("@/api/client.ts", () => ({
  api: {
    approvePlan: vi.fn(),
    rejectPlan: vi.fn(),
    approveReview: vi.fn(),
    pauseRun: vi.fn(),
    resumeRun: vi.fn(),
  },
}));

import { api } from "@/api/client.ts";

const mockApi = api as unknown as {
  approvePlan: ReturnType<typeof vi.fn>;
  rejectPlan: ReturnType<typeof vi.fn>;
  approveReview: ReturnType<typeof vi.fn>;
  pauseRun: ReturnType<typeof vi.fn>;
  resumeRun: ReturnType<typeof vi.fn>;
};

function makeRun(overrides: Partial<Run> = {}): Run {
  return {
    id: "run-abcdefgh1234",
    linearIssueId: "issue-abcdefgh",
    linearIssueIdentifier: "ENG-123",
    linearIssueDescription: null,
    linearIssueTitle: "Fix the thing",
    linearIssueUrl: "https://linear.app/team/issue/ENG-123",
    repo: "org/repo",
    branchName: "feature/x",
    prNumber: 42,
    state: "Implementing",
    planVersion: 1,
    approvedPlanVersion: null,
    plannerRuntime: null,
    executorRuntime: null,
    reviewerRuntime: null,
    remediationRuntime: null,
    workingDirectory: "/tmp",
    latestArtifactVersion: 1,
    createdAt: "2024-01-01T00:00:00.000Z",
    updatedAt: "2024-01-01T00:00:00.000Z",
    ...overrides,
  };
}

function renderTable(runs: Run[], onAction?: () => void) {
  return render(
    <MemoryRouter>
      <RunsTable runs={runs} onAction={onAction} />
    </MemoryRouter>,
  );
}

describe("RunsTable", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("renders the empty state when there are no runs", () => {
    renderTable([]);
    expect(screen.getByText("No runs found")).toBeDefined();
    expect(screen.queryByRole("table")).toBeNull();
  });

  it("renders a row with issue title, repo, PR number and state", () => {
    renderTable([makeRun()]);
    expect(screen.getByText("Fix the thing")).toBeDefined();
    expect(screen.getByText("org/repo")).toBeDefined();
    expect(screen.getByText("#42")).toBeDefined();
    expect(screen.getByText("Implementing")).toBeDefined();
  });

  it("renders an em dash when the run has no PR number", () => {
    renderTable([makeRun({ prNumber: null })]);
    expect(screen.getByText("—")).toBeDefined();
  });

  it("falls back to the Linear identifier when there is no issue title", () => {
    renderTable([makeRun({ linearIssueTitle: null })]);
    expect(screen.getByText("ENG-123")).toBeDefined();
  });

  it("falls back to a truncated issue id when there is no title or identifier", () => {
    renderTable([
      makeRun({
        linearIssueTitle: null,
        linearIssueIdentifier: null,
        linearIssueId: "issue-abcdefgh-long-id",
      }),
    ]);
    expect(screen.getByText("issue-ab")).toBeDefined();
  });

  it("links the issue title to the run detail page", () => {
    renderTable([makeRun()]);
    const link = screen.getByText("Fix the thing").closest("a");
    expect(link).not.toBeNull();
    expect(link?.getAttribute("href")).toBe("/runs/run-abcdefgh1234");
  });

  it("renders an external Linear link when linearIssueUrl is present", () => {
    renderTable([makeRun({ linearIssueUrl: "https://linear.app/x" })]);
    const externalLink = screen.getByTitle("Open in Linear");
    expect(externalLink.getAttribute("href")).toBe("https://linear.app/x");
    expect(externalLink.getAttribute("target")).toBe("_blank");
  });

  it("does not render an external Linear link when linearIssueUrl is null", () => {
    renderTable([makeRun({ linearIssueUrl: null })]);
    expect(screen.queryByTitle("Open in Linear")).toBeNull();
  });

  it("shows Approve/Reject Plan actions for AwaitingPlanApproval and calls the API", async () => {
    mockApi.approvePlan.mockResolvedValue({ ok: true, state: "Implementing" });
    const onAction = vi.fn();
    renderTable([makeRun({ state: "AwaitingPlanApproval" })], onAction);

    expect(screen.getByTitle("Approve Plan")).toBeDefined();
    expect(screen.getByTitle("Reject Plan")).toBeDefined();

    await userEvent.click(screen.getByTitle("Approve Plan"));
    expect(mockApi.approvePlan).toHaveBeenCalledWith("run-abcdefgh1234");
    expect(onAction).toHaveBeenCalledOnce();
  });

  it("calls rejectPlan when Reject Plan is clicked", async () => {
    mockApi.rejectPlan.mockResolvedValue({ ok: true, state: "Planning" });
    const onAction = vi.fn();
    renderTable([makeRun({ state: "AwaitingPlanApproval" })], onAction);

    await userEvent.click(screen.getByTitle("Reject Plan"));
    expect(mockApi.rejectPlan).toHaveBeenCalledWith("run-abcdefgh1234");
    expect(onAction).toHaveBeenCalledOnce();
  });

  it("shows Approve & Complete action for ReadyForHumanReview and calls approveReview", async () => {
    mockApi.approveReview.mockResolvedValue({ ok: true, state: "Done" });
    const onAction = vi.fn();
    renderTable([makeRun({ state: "ReadyForHumanReview" })], onAction);

    const btn = screen.getByTitle("Approve & Complete");
    await userEvent.click(btn);
    expect(mockApi.approveReview).toHaveBeenCalledWith("run-abcdefgh1234");
    expect(onAction).toHaveBeenCalledOnce();
  });

  it("does not show plan-approval or human-review actions for those states when state doesn't match", () => {
    renderTable([makeRun({ state: "Implementing" })]);
    expect(screen.queryByTitle("Approve Plan")).toBeNull();
    expect(screen.queryByTitle("Reject Plan")).toBeNull();
    expect(screen.queryByTitle("Approve & Complete")).toBeNull();
  });

  it("shows Pause Run action for an active-category state and calls pauseRun", async () => {
    mockApi.pauseRun.mockResolvedValue({ ok: true, state: "Todo" });
    const onAction = vi.fn();
    renderTable([makeRun({ state: "Implementing" })], onAction);

    await userEvent.click(screen.getByTitle("Pause Run"));
    expect(mockApi.pauseRun).toHaveBeenCalledWith("run-abcdefgh1234");
    expect(onAction).toHaveBeenCalledOnce();
  });

  it("does not show Pause Run for a non-active state", () => {
    renderTable([makeRun({ state: "Todo" })]);
    expect(screen.queryByTitle("Pause Run")).toBeNull();
  });

  it("shows Resume Run action for AIBlocked and calls resumeRun", async () => {
    mockApi.resumeRun.mockResolvedValue({ ok: true, state: "Implementing" });
    const onAction = vi.fn();
    renderTable([makeRun({ state: "AIBlocked" })], onAction);

    await userEvent.click(screen.getByTitle("Resume Run"));
    expect(mockApi.resumeRun).toHaveBeenCalledWith("run-abcdefgh1234");
    expect(onAction).toHaveBeenCalledOnce();
  });

  it("shows Resume Run action for HumanClarificationNeeded", () => {
    renderTable([makeRun({ state: "HumanClarificationNeeded" })]);
    expect(screen.getByTitle("Resume Run")).toBeDefined();
  });

  it("does not show Resume Run for a state outside the blocked set", () => {
    renderTable([makeRun({ state: "Implementing" })]);
    expect(screen.queryByTitle("Resume Run")).toBeNull();
  });

  it("swallows action errors without calling onAction", async () => {
    mockApi.pauseRun.mockRejectedValue(new Error("network error"));
    const onAction = vi.fn();
    renderTable([makeRun({ state: "Implementing" })], onAction);

    await userEvent.click(screen.getByTitle("Pause Run"));
    // allow the rejected promise microtask to settle
    await vi.waitFor(() => {
      expect(mockApi.pauseRun).toHaveBeenCalled();
    });
    expect(onAction).not.toHaveBeenCalled();
  });

  it("works without an onAction callback provided", async () => {
    mockApi.pauseRun.mockResolvedValue({ ok: true, state: "Todo" });
    renderTable([makeRun({ state: "Implementing" })]);
    await userEvent.click(screen.getByTitle("Pause Run"));
    expect(mockApi.pauseRun).toHaveBeenCalled();
  });

  it("renders multiple rows, one per run", () => {
    renderTable([
      makeRun({ id: "run-1", linearIssueId: "iss-1", linearIssueTitle: "First" }),
      makeRun({ id: "run-2", linearIssueId: "iss-2", linearIssueTitle: "Second" }),
    ]);
    expect(screen.getByText("First")).toBeDefined();
    expect(screen.getByText("Second")).toBeDefined();
    expect(screen.getAllByRole("row")).toHaveLength(3); // header + 2 rows
  });
});
