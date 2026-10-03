import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
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
    linearIssueId: "issue-1",
    linearIssueIdentifier: "ENG-1",
    linearIssueDescription: null,
    linearIssueTitle: "Fix the bug",
    linearIssueUrl: "https://linear.app/issue/ENG-1",
    repo: "org/repo",
    branchName: null,
    prNumber: 12,
    state: "Todo",
    planVersion: 1,
    approvedPlanVersion: null,
    plannerRuntime: null,
    executorRuntime: null,
    reviewerRuntime: null,
    updatedAt: new Date().toISOString(),
    ...overrides,
  } as Run;
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

  it("renders an empty state when there are no runs", () => {
    renderTable([]);
    expect(screen.getByText("No runs found")).toBeDefined();
  });

  it("renders a row per run with issue title, repo, and PR number", () => {
    renderTable([
      makeRun({ id: "run-1", linearIssueTitle: "Fix the bug", prNumber: 12 }),
      makeRun({ id: "run-2", linearIssueTitle: "Add a feature", prNumber: null }),
    ]);
    expect(screen.getByText("Fix the bug")).toBeDefined();
    expect(screen.getByText("Add a feature")).toBeDefined();
    expect(screen.getByText("#12")).toBeDefined();
    expect(screen.getByText("—")).toBeDefined();
    expect(screen.getAllByText("org/repo")).toHaveLength(2);
  });

  it("falls back to the issue identifier, then the id prefix, when no title", () => {
    renderTable([
      makeRun({
        id: "run-1",
        linearIssueTitle: null,
        linearIssueIdentifier: "ENG-42",
      }),
    ]);
    expect(screen.getByText("ENG-42")).toBeDefined();
  });

  it("renders a link to open the issue in Linear when a URL is present", () => {
    renderTable([makeRun({ linearIssueUrl: "https://linear.app/issue/ENG-1" })]);
    const link = screen.getByTitle("Open in Linear");
    expect(link.getAttribute("href")).toBe("https://linear.app/issue/ENG-1");
  });

  it("does not render the Linear link when no URL is present", () => {
    renderTable([makeRun({ linearIssueUrl: null })]);
    expect(screen.queryByTitle("Open in Linear")).toBeNull();
  });

  it("stops the Linear link's click from propagating past React's root listener", async () => {
    const user = userEvent.setup();
    renderTable([makeRun({ linearIssueUrl: "https://linear.app/issue/ENG-1" })]);
    const link = screen.getByTitle("Open in Linear");

    // React 18's root listener sits on the render container, which is a
    // descendant of document.body. Native bubbling reaches body only after
    // passing through (and being handled by) that root listener, so a
    // document.body listener observes whether React's synthetic
    // stopPropagation call also halted native propagation.
    const bodyClickSpy = vi.fn();
    document.body.addEventListener("click", bodyClickSpy);

    try {
      await user.click(link);
      expect(bodyClickSpy).not.toHaveBeenCalled();
    } finally {
      document.body.removeEventListener("click", bodyClickSpy);
    }
  });

  it("shows approve/reject plan actions for AwaitingPlanApproval and calls the API", async () => {
    const user = userEvent.setup();
    const onAction = vi.fn();
    mockApi.approvePlan.mockResolvedValue(undefined);
    renderTable([makeRun({ state: "AwaitingPlanApproval" })], onAction);

    await user.click(screen.getByTitle("Approve Plan"));
    expect(mockApi.approvePlan).toHaveBeenCalledWith("run-1");
    expect(onAction).toHaveBeenCalledOnce();
  });

  it("calls rejectPlan when the reject action is clicked", async () => {
    const user = userEvent.setup();
    mockApi.rejectPlan.mockResolvedValue(undefined);
    renderTable([makeRun({ state: "AwaitingPlanApproval" })]);

    await user.click(screen.getByTitle("Reject Plan"));
    expect(mockApi.rejectPlan).toHaveBeenCalledWith("run-1");
  });

  it("shows the approve & complete action for ReadyForHumanReview", async () => {
    const user = userEvent.setup();
    mockApi.approveReview.mockResolvedValue(undefined);
    renderTable([makeRun({ state: "ReadyForHumanReview" })]);

    const btn = screen.getByTitle("Approve & Complete");
    await user.click(btn);
    expect(mockApi.approveReview).toHaveBeenCalledWith("run-1");
  });

  it("shows the pause action for active-category states", async () => {
    const user = userEvent.setup();
    mockApi.pauseRun.mockResolvedValue(undefined);
    renderTable([makeRun({ state: "Implementing" })]);

    await user.click(screen.getByTitle("Pause Run"));
    expect(mockApi.pauseRun).toHaveBeenCalledWith("run-1");
  });

  it("shows the resume action for AIBlocked and HumanClarificationNeeded states", async () => {
    const user = userEvent.setup();
    mockApi.resumeRun.mockResolvedValue(undefined);
    renderTable([makeRun({ id: "run-1", state: "AIBlocked" })]);

    await user.click(screen.getByTitle("Resume Run"));
    expect(mockApi.resumeRun).toHaveBeenCalledWith("run-1");
  });

  it("does not call onAction and does not throw when the action rejects", async () => {
    const user = userEvent.setup();
    const onAction = vi.fn();
    mockApi.approvePlan.mockRejectedValue(new Error("network error"));
    renderTable([makeRun({ state: "AwaitingPlanApproval" })], onAction);

    await user.click(screen.getByTitle("Approve Plan"));
    expect(onAction).not.toHaveBeenCalled();
  });

  it("renders no action buttons for a plain Todo state besides navigation", () => {
    renderTable([makeRun({ state: "Todo" })]);
    expect(screen.queryByTitle("Approve Plan")).toBeNull();
    expect(screen.queryByTitle("Approve & Complete")).toBeNull();
    expect(screen.queryByTitle("Pause Run")).toBeNull();
    expect(screen.queryByTitle("Resume Run")).toBeNull();
  });
});
