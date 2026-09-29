import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import type { Run } from "@/api/client.ts";

vi.mock("@/api/client.ts", () => ({
  api: {
    approvePlan: vi.fn(),
    rejectPlan: vi.fn(),
    approveReview: vi.fn(),
    pauseRun: vi.fn(),
    resumeRun: vi.fn(),
  },
}));

import { RunsTable } from "./RunsTable.tsx";
import { api } from "@/api/client.ts";

const mockApi = api as unknown as Record<string, ReturnType<typeof vi.fn>>;

function makeRun(overrides: Partial<Run> & Pick<Run, "id" | "state">): Run {
  return {
    linearIssueId: "issue-1",
    linearIssueIdentifier: "ENG-1",
    linearIssueDescription: null,
    linearIssueTitle: "Fix the bug",
    linearIssueUrl: null,
    repo: "org/repo",
    branchName: null,
    prNumber: null,
    planVersion: 1,
    approvedPlanVersion: null,
    plannerRuntime: null,
    executorRuntime: null,
    reviewerRuntime: null,
    remediationRuntime: null,
    workingDirectory: "/tmp/wd",
    latestArtifactVersion: 1,
    createdAt: "2024-01-01T00:00:00Z",
    updatedAt: "2024-01-01T00:00:00Z",
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

  it("renders the 'No runs found' empty state when there are no runs", () => {
    renderTable([]);
    expect(screen.getByText(/No runs found/i)).toBeDefined();
  });

  it("renders one row per run with issue title, repo, and PR number", () => {
    const runs = [
      makeRun({ id: "r1", state: "Todo", linearIssueTitle: "First issue", repo: "org/a" }),
      makeRun({
        id: "r2",
        state: "Implementing",
        linearIssueTitle: "Second issue",
        repo: "org/b",
        prNumber: 42,
      }),
    ];
    renderTable(runs);

    expect(screen.getByText("First issue")).toBeDefined();
    expect(screen.getByText("Second issue")).toBeDefined();
    expect(screen.getByText("org/a")).toBeDefined();
    expect(screen.getByText("org/b")).toBeDefined();
    expect(screen.getByText("#42")).toBeDefined();

    const rows = screen.getAllByRole("row");
    // 1 header row + 2 data rows
    expect(rows.length).toBe(3);
  });

  it("links each run row to its detail page", () => {
    const runs = [makeRun({ id: "run-abc", state: "Todo", linearIssueTitle: "Navigate me" })];
    renderTable(runs);
    const link = screen.getByRole("link", { name: "Navigate me" });
    expect(link.getAttribute("href")).toBe("/runs/run-abc");
  });

  it("calls api.approvePlan when the Approve Plan action is clicked for AwaitingPlanApproval runs", async () => {
    mockApi.approvePlan.mockResolvedValue(undefined);
    const onAction = vi.fn();
    const runs = [makeRun({ id: "r1", state: "AwaitingPlanApproval" })];
    renderTable(runs, onAction);

    const approveBtn = screen.getByTitle("Approve Plan");
    await userEvent.click(approveBtn);

    expect(mockApi.approvePlan).toHaveBeenCalledWith("r1");
    expect(onAction).toHaveBeenCalledOnce();
  });

  it("calls api.rejectPlan when the Reject Plan action is clicked", async () => {
    mockApi.rejectPlan.mockResolvedValue(undefined);
    const onAction = vi.fn();
    const runs = [makeRun({ id: "r1", state: "AwaitingPlanApproval" })];
    renderTable(runs, onAction);

    await userEvent.click(screen.getByTitle("Reject Plan"));

    expect(mockApi.rejectPlan).toHaveBeenCalledWith("r1");
    expect(onAction).toHaveBeenCalledOnce();
  });

  it("does not call onAction when the API action rejects", async () => {
    mockApi.approvePlan.mockRejectedValue(new Error("boom"));
    const onAction = vi.fn();
    const runs = [makeRun({ id: "r1", state: "AwaitingPlanApproval" })];
    renderTable(runs, onAction);

    await userEvent.click(screen.getByTitle("Approve Plan"));

    expect(mockApi.approvePlan).toHaveBeenCalled();
    expect(onAction).not.toHaveBeenCalled();
  });

  it("shows Pause for active runs and Resume for blocked runs, and calls the matching api action", async () => {
    mockApi.pauseRun.mockResolvedValue(undefined);
    mockApi.resumeRun.mockResolvedValue(undefined);
    const onAction = vi.fn();
    const runs = [
      makeRun({ id: "r1", state: "Implementing" }),
      makeRun({ id: "r2", state: "AIBlocked" }),
    ];
    renderTable(runs, onAction);

    expect(screen.getByTitle("Pause Run")).toBeDefined();
    expect(screen.getByTitle("Resume Run")).toBeDefined();

    await userEvent.click(screen.getByTitle("Pause Run"));
    expect(mockApi.pauseRun).toHaveBeenCalledWith("r1");

    await userEvent.click(screen.getByTitle("Resume Run"));
    expect(mockApi.resumeRun).toHaveBeenCalledWith("r2");

    expect(onAction).toHaveBeenCalledTimes(2);
  });

  it("shows Approve & Complete for ReadyForHumanReview runs", async () => {
    mockApi.approveReview.mockResolvedValue(undefined);
    const onAction = vi.fn();
    const runs = [makeRun({ id: "r1", state: "ReadyForHumanReview" })];
    renderTable(runs, onAction);

    await userEvent.click(screen.getByTitle("Approve & Complete"));
    expect(mockApi.approveReview).toHaveBeenCalledWith("r1");
    expect(onAction).toHaveBeenCalledOnce();
  });

  it("falls back to the issue identifier or id when no title is present", () => {
    const runs = [
      makeRun({
        id: "r1",
        state: "Todo",
        linearIssueTitle: null,
        linearIssueIdentifier: "ENG-99",
      }),
    ];
    renderTable(runs);
    expect(screen.getByText("ENG-99")).toBeDefined();
  });

  it("renders an external Linear link when linearIssueUrl is present, and clicking it does not navigate to the run detail row", async () => {
    const runs = [
      makeRun({
        id: "r1",
        state: "Todo",
        linearIssueUrl: "https://linear.app/team/issue/ENG-1",
      }),
    ];
    renderTable(runs);
    const externalLink = screen.getByTitle("Open in Linear");
    expect(externalLink.getAttribute("href")).toBe("https://linear.app/team/issue/ENG-1");

    // The link's onClick stops propagation so the row's own navigation isn't
    // triggered; clicking it should not throw and the link stays in the DOM.
    await userEvent.click(externalLink);
    expect(screen.getByTitle("Open in Linear")).toBeDefined();
  });
});
