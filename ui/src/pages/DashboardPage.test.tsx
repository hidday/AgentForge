import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import type { Run } from "@/api/client.ts";

const useRunsMock = vi.fn();

vi.mock("@/hooks/useRuns.ts", () => ({
  useRuns: () => useRunsMock(),
}));

vi.mock("@/components/RunsTable.tsx", () => ({
  RunsTable: ({ runs }: { runs: Run[] }) => (
    <div data-testid="runs-table">
      {runs.map((r) => (
        <div key={r.id} data-testid="run-row">
          {r.id}:{r.state}
        </div>
      ))}
    </div>
  ),
}));

vi.mock("@/components/LinearSyncDialog.tsx", () => ({
  LinearSyncDialog: ({ open }: { open: boolean }) => (
    <div data-testid="sync-dialog" data-open={open ? "true" : "false"} />
  ),
}));

vi.mock("@/components/IngestSummaryBanner.tsx", () => ({
  IngestSummaryBanner: ({ started, skipped }: { started: number; skipped: number }) => (
    <div data-testid="ingest-banner">
      started:{started} skipped:{skipped}
    </div>
  ),
}));

import { DashboardPage } from "./DashboardPage.tsx";

function makeRun(overrides: Partial<Run>): Run {
  return {
    id: "run-1",
    linearIssueId: "issue-1",
    linearIssueIdentifier: "ENG-1",
    linearIssueDescription: null,
    linearIssueTitle: "Fix the bug",
    linearIssueUrl: null,
    repo: "org/repo",
    branchName: null,
    prNumber: null,
    state: "Todo",
    planVersion: 1,
    approvedPlanVersion: null,
    plannerRuntime: null,
    executorRuntime: null,
    reviewerRuntime: null,
    remediationRuntime: null,
    workingDirectory: "/tmp/repo",
    latestArtifactVersion: 1,
    createdAt: "2024-01-01T00:00:00.000Z",
    updatedAt: "2024-01-01T00:00:00.000Z",
    ...overrides,
  } as Run;
}

describe("DashboardPage", () => {
  beforeEach(() => {
    useRunsMock.mockReset();
  });

  it("shows a loading indicator while runs are loading", () => {
    useRunsMock.mockReturnValue({
      runs: [],
      loading: true,
      error: null,
      refetch: vi.fn(),
    });

    render(<DashboardPage />);

    expect(screen.getByText(/Loading runs/i)).toBeDefined();
    expect(screen.queryByTestId("runs-table")).toBeNull();
  });

  it("shows an error message when fetching runs fails", () => {
    useRunsMock.mockReturnValue({
      runs: [],
      loading: false,
      error: "Failed to fetch runs",
      refetch: vi.fn(),
    });

    render(<DashboardPage />);

    expect(screen.getByText("Failed to fetch runs")).toBeDefined();
    expect(screen.queryByTestId("runs-table")).toBeNull();
  });

  it("renders the RunsTable with fetched runs on success", () => {
    const runs = [
      makeRun({ id: "run-1", state: "Planning" }),
      makeRun({ id: "run-2", state: "Done" }),
    ];
    useRunsMock.mockReturnValue({
      runs,
      loading: false,
      error: null,
      refetch: vi.fn(),
    });

    render(<DashboardPage />);

    expect(screen.getByTestId("runs-table")).toBeDefined();
    const rows = screen.getAllByTestId("run-row");
    expect(rows).toHaveLength(2);
    expect(rows[0].textContent).toBe("run-1:Planning");
    expect(rows[1].textContent).toBe("run-2:Done");
  });

  it("computes and displays the stats bar counts per state category", () => {
    // One run per category so each stat (other than Total) reads exactly "1".
    const runs = [
      makeRun({ id: "run-1", state: "Planning" }), // active
      makeRun({ id: "run-3", state: "AwaitingPlanApproval" }), // waiting
      makeRun({ id: "run-4", state: "AIBlocked" }), // blocked
      makeRun({ id: "run-5", state: "Done" }), // done
    ];
    useRunsMock.mockReturnValue({
      runs,
      loading: false,
      error: null,
      refetch: vi.fn(),
    });

    render(<DashboardPage />);

    expect(screen.getByText("Total")).toBeDefined();
    // Total count (4 runs)
    expect(screen.getByText("4")).toBeDefined();
    // Each category (active, waiting, blocked, done) should show a count of "1"
    const ones = screen.getAllByText("1");
    expect(ones.length).toBe(4);
  });

  it("filters runs by category when a filter button is clicked", () => {
    const runs = [
      makeRun({ id: "run-1", state: "Planning" }), // active
      makeRun({ id: "run-2", state: "Done" }), // done
    ];
    useRunsMock.mockReturnValue({
      runs,
      loading: false,
      error: null,
      refetch: vi.fn(),
    });

    render(<DashboardPage />);

    // Initially both rows are shown (filter = all)
    expect(screen.getAllByTestId("run-row")).toHaveLength(2);

    fireEvent.click(screen.getByRole("button", { name: "Done" }));

    const rows = screen.getAllByTestId("run-row");
    expect(rows).toHaveLength(1);
    expect(rows[0].textContent).toBe("run-2:Done");
  });

  it("filters back to all runs when 'All' is clicked after another filter", () => {
    const runs = [
      makeRun({ id: "run-1", state: "Planning" }),
      makeRun({ id: "run-2", state: "Done" }),
    ];
    useRunsMock.mockReturnValue({
      runs,
      loading: false,
      error: null,
      refetch: vi.fn(),
    });

    render(<DashboardPage />);

    fireEvent.click(screen.getByRole("button", { name: "Active" }));
    expect(screen.getAllByTestId("run-row")).toHaveLength(1);

    fireEvent.click(screen.getByRole("button", { name: "All" }));
    expect(screen.getAllByTestId("run-row")).toHaveLength(2);
  });

  it("opens the Linear sync dialog when 'Sync from Linear' is clicked", () => {
    useRunsMock.mockReturnValue({
      runs: [],
      loading: false,
      error: null,
      refetch: vi.fn(),
    });

    render(<DashboardPage />);

    expect(screen.getByTestId("sync-dialog").getAttribute("data-open")).toBe("false");

    fireEvent.click(screen.getByRole("button", { name: /Sync from Linear/i }));

    expect(screen.getByTestId("sync-dialog").getAttribute("data-open")).toBe("true");
  });

  it("renders the empty state (no rows) when there are no runs and no error/loading", () => {
    useRunsMock.mockReturnValue({
      runs: [],
      loading: false,
      error: null,
      refetch: vi.fn(),
    });

    render(<DashboardPage />);

    expect(screen.getByTestId("runs-table")).toBeDefined();
    expect(screen.queryAllByTestId("run-row")).toHaveLength(0);
  });

  it("does not render the ingest summary banner initially", () => {
    useRunsMock.mockReturnValue({
      runs: [],
      loading: false,
      error: null,
      refetch: vi.fn(),
    });

    render(<DashboardPage />);

    expect(screen.queryByTestId("ingest-banner")).toBeNull();
  });
});
