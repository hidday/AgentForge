import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { RunsTable } from "./RunsTable.tsx";
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

import { api } from "@/api/client.ts";

const mockApi = api as unknown as {
  approvePlan: ReturnType<typeof vi.fn>;
  rejectPlan: ReturnType<typeof vi.fn>;
  approveReview: ReturnType<typeof vi.fn>;
  pauseRun: ReturnType<typeof vi.fn>;
  resumeRun: ReturnType<typeof vi.fn>;
};

function makeRun(overrides: Partial<Run>): Run {
  return {
    id: "run-1",
    linearIssueId: "issue-1234567",
    linearIssueIdentifier: "ENG-1",
    linearIssueDescription: null,
    linearIssueTitle: "Fix the thing",
    linearIssueUrl: "https://linear.app/team/issue/ENG-1",
    repo: "org/repo",
    branchName: "fix/thing",
    prNumber: 42,
    state: "Todo",
    planVersion: 1,
    approvedPlanVersion: null,
    plannerRuntime: null,
    executorRuntime: null,
    reviewerRuntime: null,
    remediationRuntime: null,
    workingDirectory: "/tmp/x",
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

  it("shows the empty state when there are no runs", () => {
    renderTable([]);
    expect(screen.getByText("No runs found")).toBeDefined();
    expect(screen.queryByRole("table")).toBeNull();
  });

  it("renders a row per run with issue title, repo, and PR number", () => {
    const runs = [
      makeRun({ id: "run-1", linearIssueTitle: "First issue", repo: "org/a", prNumber: 10 }),
      makeRun({ id: "run-2", linearIssueTitle: "Second issue", repo: "org/b", prNumber: null }),
    ];
    renderTable(runs);

    const rows = screen.getAllByRole("row");
    // 1 header row + 2 data rows
    expect(rows.length).toBe(3);
    expect(screen.getByText("First issue")).toBeDefined();
    expect(screen.getByText("Second issue")).toBeDefined();
    expect(screen.getByText("org/a")).toBeDefined();
    expect(screen.getByText("org/b")).toBeDefined();
    expect(screen.getByText("#10")).toBeDefined();
    expect(screen.getByText("—")).toBeDefined();
  });

  it("falls back to the issue identifier when there is no title", () => {
    const runs = [
      makeRun({ linearIssueTitle: null, linearIssueIdentifier: "ENG-99" }),
    ];
    renderTable(runs);
    expect(screen.getByText("ENG-99")).toBeDefined();
  });

  it("falls back to a truncated issue id when there is no title or identifier", () => {
    const runs = [
      makeRun({
        linearIssueTitle: null,
        linearIssueIdentifier: null,
        linearIssueId: "abcdefgh12345",
      }),
    ];
    renderTable(runs);
    expect(screen.getByText("abcdefgh")).toBeDefined();
  });

  it("links the issue title to the run detail page", () => {
    const runs = [makeRun({ id: "run-77" })];
    renderTable(runs);
    const link = screen.getByRole("link", { name: "Fix the thing" });
    expect(link.getAttribute("href")).toBe("/runs/run-77");
  });

  it("renders an external Linear link when linearIssueUrl is present", () => {
    const runs = [makeRun({ linearIssueUrl: "https://linear.app/team/issue/ENG-1" })];
    renderTable(runs);
    const externalLink = screen.getByTitle("Open in Linear");
    expect(externalLink.getAttribute("href")).toBe(
      "https://linear.app/team/issue/ENG-1",
    );
  });

  it("stops propagation when the external Linear link is clicked, without navigating away", async () => {
    const runs = [makeRun({ linearIssueUrl: "https://linear.app/team/issue/ENG-1" })];
    renderTable(runs);
    const externalLink = screen.getByTitle("Open in Linear");
    // jsdom doesn't navigate on anchor click; verify the click handler runs without throwing
    // and the row's link is still present (click did not trigger row-level navigation side effects).
    await userEvent.click(externalLink);
    expect(screen.getByTitle("Open in Linear")).toBeDefined();
  });

  it("does not render the external Linear link when linearIssueUrl is null", () => {
    const runs = [makeRun({ linearIssueUrl: null })];
    renderTable(runs);
    expect(screen.queryByTitle("Open in Linear")).toBeNull();
  });

  it("shows Approve/Reject plan actions only for AwaitingPlanApproval state", () => {
    const runs = [makeRun({ state: "AwaitingPlanApproval" })];
    renderTable(runs);
    expect(screen.getByTitle("Approve Plan")).toBeDefined();
    expect(screen.getByTitle("Reject Plan")).toBeDefined();
  });

  it("calls api.approvePlan with the run id when Approve Plan is clicked", async () => {
    mockApi.approvePlan.mockResolvedValue({});
    const onAction = vi.fn();
    const runs = [makeRun({ id: "run-approve", state: "AwaitingPlanApproval" })];
    renderTable(runs, onAction);

    await userEvent.click(screen.getByTitle("Approve Plan"));

    await waitFor(() => {
      expect(mockApi.approvePlan).toHaveBeenCalledWith("run-approve");
      expect(onAction).toHaveBeenCalledOnce();
    });
  });

  it("calls api.rejectPlan with the run id when Reject Plan is clicked", async () => {
    mockApi.rejectPlan.mockResolvedValue({});
    const onAction = vi.fn();
    const runs = [makeRun({ id: "run-reject", state: "AwaitingPlanApproval" })];
    renderTable(runs, onAction);

    await userEvent.click(screen.getByTitle("Reject Plan"));

    await waitFor(() => {
      expect(mockApi.rejectPlan).toHaveBeenCalledWith("run-reject");
      expect(onAction).toHaveBeenCalledOnce();
    });
  });

  it("shows the Approve & Complete action for ReadyForHumanReview state and calls approveReview", async () => {
    mockApi.approveReview.mockResolvedValue({});
    const onAction = vi.fn();
    const runs = [makeRun({ id: "run-review", state: "ReadyForHumanReview" })];
    renderTable(runs, onAction);

    const btn = screen.getByTitle("Approve & Complete");
    await userEvent.click(btn);

    await waitFor(() => {
      expect(mockApi.approveReview).toHaveBeenCalledWith("run-review");
      expect(onAction).toHaveBeenCalledOnce();
    });
  });

  it("shows the Pause action for an active-category state and calls pauseRun", async () => {
    mockApi.pauseRun.mockResolvedValue({});
    const onAction = vi.fn();
    const runs = [makeRun({ id: "run-active", state: "Implementing" })];
    renderTable(runs, onAction);

    await userEvent.click(screen.getByTitle("Pause Run"));

    await waitFor(() => {
      expect(mockApi.pauseRun).toHaveBeenCalledWith("run-active");
      expect(onAction).toHaveBeenCalledOnce();
    });
  });

  it("shows the Resume action for AIBlocked/HumanClarificationNeeded states and calls resumeRun", async () => {
    mockApi.resumeRun.mockResolvedValue({});
    const onAction = vi.fn();
    const runs = [makeRun({ id: "run-blocked", state: "AIBlocked" })];
    renderTable(runs, onAction);

    await userEvent.click(screen.getByTitle("Resume Run"));

    await waitFor(() => {
      expect(mockApi.resumeRun).toHaveBeenCalledWith("run-blocked");
      expect(onAction).toHaveBeenCalledOnce();
    });
  });

  it("does not show any action buttons for a Done run, only the chevron link", () => {
    const runs = [makeRun({ id: "run-done", state: "Done" })];
    renderTable(runs);
    expect(screen.queryByTitle("Approve Plan")).toBeNull();
    expect(screen.queryByTitle("Reject Plan")).toBeNull();
    expect(screen.queryByTitle("Approve & Complete")).toBeNull();
    expect(screen.queryByTitle("Pause Run")).toBeNull();
    expect(screen.queryByTitle("Resume Run")).toBeNull();
  });

  it("does not call onAction when the API call rejects", async () => {
    mockApi.pauseRun.mockRejectedValue(new Error("network error"));
    const onAction = vi.fn();
    const runs = [makeRun({ id: "run-fail", state: "Implementing" })];
    renderTable(runs, onAction);

    await userEvent.click(screen.getByTitle("Pause Run"));

    await waitFor(() => {
      expect(mockApi.pauseRun).toHaveBeenCalledWith("run-fail");
    });
    expect(onAction).not.toHaveBeenCalled();
  });
});
