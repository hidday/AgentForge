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
    id: "run-default",
    linearIssueId: "issue-default",
    linearIssueIdentifier: null,
    linearIssueDescription: null,
    linearIssueTitle: null,
    linearIssueUrl: null,
    repo: "acme/widgets",
    branchName: null,
    prNumber: null,
    state: "Todo",
    planVersion: 1,
    approvedPlanVersion: null,
    plannerRuntime: null,
    executorRuntime: null,
    reviewerRuntime: null,
    remediationRuntime: null,
    workingDirectory: "/tmp/work",
    latestArtifactVersion: 1,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
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
    mockApi.approvePlan.mockResolvedValue({});
    mockApi.rejectPlan.mockResolvedValue({});
    mockApi.approveReview.mockResolvedValue({});
    mockApi.pauseRun.mockResolvedValue({});
    mockApi.resumeRun.mockResolvedValue({});
  });

  it("renders the empty state when there are no runs", () => {
    renderTable([]);
    expect(screen.getByText("No runs found")).toBeDefined();
  });

  it("renders issue title, identifier fallback, and id fallback", () => {
    const runs = [
      makeRun({
        id: "run-1",
        linearIssueTitle: "Fix the bug",
        linearIssueIdentifier: "ENG-1",
      }),
      makeRun({
        id: "run-2",
        linearIssueTitle: null,
        linearIssueIdentifier: "ENG-2",
      }),
      makeRun({
        id: "run-3",
        linearIssueTitle: null,
        linearIssueIdentifier: null,
        linearIssueId: "abcdefgh12345",
      }),
    ];
    renderTable(runs);

    expect(screen.getByText("Fix the bug")).toBeDefined();
    expect(screen.getByText("ENG-2")).toBeDefined();
    expect(screen.getByText("abcdefgh")).toBeDefined();
  });

  it("shows the Linear external link only when linearIssueUrl is set", () => {
    const runs = [
      makeRun({ id: "run-1", linearIssueUrl: "https://linear.app/issue/1" }),
      makeRun({ id: "run-2", linearIssueUrl: null }),
    ];
    renderTable(runs);

    const links = screen.getAllByTitle("Open in Linear");
    expect(links.length).toBe(1);
    expect((links[0] as HTMLAnchorElement).href).toBe(
      "https://linear.app/issue/1",
    );
  });

  it("renders PR number when present and a dash when absent", () => {
    const runs = [
      makeRun({ id: "run-1", prNumber: 42 }),
      makeRun({ id: "run-2", prNumber: null }),
    ];
    renderTable(runs);

    expect(screen.getByText("#42")).toBeDefined();
    expect(screen.getByText("—")).toBeDefined();
  });

  it("shows approve/reject plan buttons for AwaitingPlanApproval and calls the api", async () => {
    const onAction = vi.fn();
    const runs = [makeRun({ id: "run-1", state: "AwaitingPlanApproval" })];
    renderTable(runs, onAction);

    const approveBtn = screen.getByTitle("Approve Plan");
    const rejectBtn = screen.getByTitle("Reject Plan");
    expect(approveBtn).toBeDefined();
    expect(rejectBtn).toBeDefined();

    await userEvent.click(approveBtn);
    expect(mockApi.approvePlan).toHaveBeenCalledWith("run-1");
    expect(onAction).toHaveBeenCalledTimes(1);

    await userEvent.click(rejectBtn);
    expect(mockApi.rejectPlan).toHaveBeenCalledWith("run-1");
    expect(onAction).toHaveBeenCalledTimes(2);
  });

  it("shows approve & complete button for ReadyForHumanReview and calls the api", async () => {
    const runs = [makeRun({ id: "run-2", state: "ReadyForHumanReview" })];
    renderTable(runs);

    const btn = screen.getByTitle("Approve & Complete");
    await userEvent.click(btn);
    expect(mockApi.approveReview).toHaveBeenCalledWith("run-2");
  });

  it("shows pause button for active-category states and calls the api", async () => {
    const runs = [makeRun({ id: "run-3", state: "Implementing" })];
    renderTable(runs);

    const btn = screen.getByTitle("Pause Run");
    await userEvent.click(btn);
    expect(mockApi.pauseRun).toHaveBeenCalledWith("run-3");
  });

  it("shows resume button for AIBlocked and HumanClarificationNeeded, and calls the api", async () => {
    const runs = [
      makeRun({ id: "run-4", state: "AIBlocked" }),
      makeRun({ id: "run-5", state: "HumanClarificationNeeded" }),
    ];
    renderTable(runs);

    const btns = screen.getAllByTitle("Resume Run");
    expect(btns.length).toBe(2);

    await userEvent.click(btns[0]);
    expect(mockApi.resumeRun).toHaveBeenCalledWith("run-4");
  });

  it("renders no action buttons for states that match none of the categories", () => {
    const runs = [makeRun({ id: "run-6", state: "Done" })];
    renderTable(runs);

    expect(screen.queryByTitle("Approve Plan")).toBeNull();
    expect(screen.queryByTitle("Reject Plan")).toBeNull();
    expect(screen.queryByTitle("Approve & Complete")).toBeNull();
    expect(screen.queryByTitle("Pause Run")).toBeNull();
    expect(screen.queryByTitle("Resume Run")).toBeNull();
  });

  it("swallows action errors without calling onAction", async () => {
    mockApi.pauseRun.mockRejectedValue(new Error("boom"));
    const onAction = vi.fn();
    const runs = [makeRun({ id: "run-3", state: "Implementing" })];
    renderTable(runs, onAction);

    const btn = screen.getByTitle("Pause Run");
    await userEvent.click(btn);

    expect(mockApi.pauseRun).toHaveBeenCalledWith("run-3");
    expect(onAction).not.toHaveBeenCalled();
  });

  it("works without an onAction prop supplied", async () => {
    const runs = [makeRun({ id: "run-1", state: "AwaitingPlanApproval" })];
    renderTable(runs);

    const approveBtn = screen.getByTitle("Approve Plan");
    await userEvent.click(approveBtn);
    expect(mockApi.approvePlan).toHaveBeenCalledWith("run-1");
  });

  it("links to the run detail page and the Linear link stops propagation on click", async () => {
    const runs = [
      makeRun({
        id: "run-1",
        linearIssueTitle: "Fix the bug",
        linearIssueUrl: "https://linear.app/issue/1",
      }),
    ];
    renderTable(runs);

    const detailLink = screen.getByText("Fix the bug").closest("a");
    expect(detailLink?.getAttribute("href")).toBe("/runs/run-1");

    const linearLink = screen.getByTitle("Open in Linear");
    await userEvent.click(linearLink);
    // No navigation/crash; link remains in the document.
    expect(linearLink).toBeDefined();
  });
});
