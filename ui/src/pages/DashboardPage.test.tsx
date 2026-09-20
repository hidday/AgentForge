import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { Run } from "@/api/client.ts";

vi.mock("@/hooks/useRuns.ts", () => ({
  useRuns: vi.fn(),
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
  LinearSyncDialog: ({ open }: { open: boolean }) =>
    open ? <div data-testid="sync-dialog">sync dialog open</div> : null,
}));

vi.mock("@/components/IngestSummaryBanner.tsx", () => ({
  IngestSummaryBanner: ({ started, skipped }: { started: number; skipped: number }) => (
    <div data-testid="ingest-banner">
      started {started}, skipped {skipped}
    </div>
  ),
}));

import { useRuns } from "@/hooks/useRuns.ts";
import { DashboardPage } from "./DashboardPage.tsx";

const mockUseRuns = useRuns as unknown as ReturnType<typeof vi.fn>;

function makeRun(overrides: Partial<Run> = {}): Run {
  return {
    id: "run-1",
    linearIssueId: "issue-1",
    linearIssueIdentifier: "ENG-1",
    linearIssueDescription: null,
    linearIssueTitle: "Fix bug",
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
    workingDirectory: "/tmp/run-1",
    latestArtifactVersion: 0,
    createdAt: "2024-01-01T00:00:00.000Z",
    updatedAt: "2024-01-01T00:00:00.000Z",
    ...overrides,
  };
}

describe("DashboardPage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("shows a loading indicator while runs are loading", () => {
    mockUseRuns.mockReturnValue({ runs: [], loading: true, error: null, refetch: vi.fn() });

    render(<DashboardPage />);

    expect(screen.getByText(/loading runs/i)).toBeDefined();
    expect(screen.queryByTestId("runs-table")).toBeNull();
  });

  it("shows an error message when the hook reports an error", () => {
    mockUseRuns.mockReturnValue({
      runs: [],
      loading: false,
      error: "Failed to fetch runs",
      refetch: vi.fn(),
    });

    render(<DashboardPage />);

    expect(screen.getByText("Failed to fetch runs")).toBeDefined();
    expect(screen.queryByTestId("runs-table")).toBeNull();
  });

  it("renders the runs table with all runs when loaded", () => {
    const runs = [makeRun({ id: "run-1" }), makeRun({ id: "run-2", state: "Done" })];
    mockUseRuns.mockReturnValue({ runs, loading: false, error: null, refetch: vi.fn() });

    render(<DashboardPage />);

    const rows = screen.getAllByTestId("run-row");
    expect(rows).toHaveLength(2);
    expect(screen.getByText("Total")).toBeDefined();
  });

  it("renders an empty runs table (no crash) when there are zero runs", () => {
    mockUseRuns.mockReturnValue({ runs: [], loading: false, error: null, refetch: vi.fn() });

    render(<DashboardPage />);

    expect(screen.getByTestId("runs-table")).toBeDefined();
    expect(screen.queryAllByTestId("run-row")).toHaveLength(0);
  });

  it("computes per-category stat counts from run states", () => {
    const runs = [
      makeRun({ id: "r1", state: "Planning" }), // active
      makeRun({ id: "r2", state: "Implementing" }), // active
      makeRun({ id: "r3", state: "AwaitingPlanApproval" }), // waiting
      makeRun({ id: "r4", state: "AIBlocked" }), // blocked
      makeRun({ id: "r5", state: "Done" }), // done
    ];
    mockUseRuns.mockReturnValue({ runs, loading: false, error: null, refetch: vi.fn() });

    render(<DashboardPage />);

    // Total count; active has 2 runs (Planning + Implementing), the other
    // three categories (waiting/blocked/done) have exactly 1 run each.
    expect(screen.getByText("5")).toBeDefined();
    expect(screen.getByText("2")).toBeDefined();
    expect(screen.getAllByText("1")).toHaveLength(3);
  });

  it("filters the visible runs when a filter button is clicked", async () => {
    const user = userEvent.setup();
    const runs = [
      makeRun({ id: "r1", state: "Planning" }), // active
      makeRun({ id: "r2", state: "Done" }), // done
    ];
    mockUseRuns.mockReturnValue({ runs, loading: false, error: null, refetch: vi.fn() });

    render(<DashboardPage />);

    expect(screen.getAllByTestId("run-row")).toHaveLength(2);

    await user.click(screen.getByRole("button", { name: "Done" }));

    const rows = screen.getAllByTestId("run-row");
    expect(rows).toHaveLength(1);
    expect(rows[0]!.textContent).toContain("r2");
  });

  it("returns to showing all runs when the All filter is re-selected", async () => {
    const user = userEvent.setup();
    const runs = [makeRun({ id: "r1", state: "Planning" }), makeRun({ id: "r2", state: "Done" })];
    mockUseRuns.mockReturnValue({ runs, loading: false, error: null, refetch: vi.fn() });

    render(<DashboardPage />);
    await user.click(screen.getByRole("button", { name: "Done" }));
    expect(screen.getAllByTestId("run-row")).toHaveLength(1);

    await user.click(screen.getByRole("button", { name: "All" }));
    expect(screen.getAllByTestId("run-row")).toHaveLength(2);
  });

  it("opens the Linear sync dialog when 'Sync from Linear' is clicked", async () => {
    const user = userEvent.setup();
    mockUseRuns.mockReturnValue({ runs: [], loading: false, error: null, refetch: vi.fn() });

    render(<DashboardPage />);

    expect(screen.queryByTestId("sync-dialog")).toBeNull();
    await user.click(screen.getByRole("button", { name: /sync from linear/i }));
    expect(screen.getByTestId("sync-dialog")).toBeDefined();
  });

  it("does not show the ingest summary banner until an ingest completes", () => {
    mockUseRuns.mockReturnValue({ runs: [], loading: false, error: null, refetch: vi.fn() });

    render(<DashboardPage />);

    expect(screen.queryByTestId("ingest-banner")).toBeNull();
  });
});
