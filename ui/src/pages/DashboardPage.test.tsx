import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, act } from "@testing-library/react";
import type { Run } from "@/api/client.ts";

vi.mock("@/hooks/useRuns.ts", () => ({
  useRuns: vi.fn(),
}));

vi.mock("@/components/RunsTable.tsx", () => ({
  RunsTable: (props: { runs: Run[]; onAction: () => void }) => (
    <div data-testid="runs-table">
      <span data-testid="runs-count">{props.runs.length}</span>
      {props.runs.map((r) => (
        <div key={r.id} data-testid={`run-${r.id}`}>
          {r.id}|{r.state}
        </div>
      ))}
      <button onClick={props.onAction}>runs-table-action</button>
    </div>
  ),
}));

vi.mock("@/components/LinearSyncDialog.tsx", () => ({
  LinearSyncDialog: (props: {
    open: boolean;
    onClose: () => void;
    onIngested: () => void;
    onIngestComplete: (s: { started: number; skipped: number }) => void;
  }) =>
    props.open ? (
      <div data-testid="linear-sync-dialog">
        <button onClick={props.onClose}>close-dialog</button>
        <button onClick={() => props.onIngested()}>ingested</button>
        <button onClick={() => props.onIngestComplete({ started: 2, skipped: 1 })}>
          complete-ingest
        </button>
      </div>
    ) : null,
}));

vi.mock("@/components/IngestSummaryBanner.tsx", () => ({
  IngestSummaryBanner: (props: {
    started: number;
    skipped: number;
    onDismiss: () => void;
  }) => (
    <div data-testid="ingest-banner">
      started:{props.started} skipped:{props.skipped}
      <button onClick={props.onDismiss}>dismiss-banner</button>
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
    linearIssueTitle: "Title",
    linearIssueUrl: null,
    repo: "org/repo",
    branchName: null,
    prNumber: null,
    state: "Planning",
    planVersion: 1,
    approvedPlanVersion: null,
    plannerRuntime: null,
    executorRuntime: null,
    reviewerRuntime: null,
    remediationRuntime: null,
    workingDirectory: "/tmp",
    latestArtifactVersion: 0,
    createdAt: "2024-01-01T00:00:00Z",
    updatedAt: "2024-01-01T00:00:00Z",
    ...overrides,
  };
}

describe("DashboardPage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("shows a loading indicator while runs are loading", () => {
    mockUseRuns.mockReturnValue({ runs: [], loading: true, error: null, refetch: vi.fn() });
    render(<DashboardPage />);

    expect(screen.getByText(/Loading runs/i)).toBeDefined();
    expect(screen.queryByTestId("runs-table")).toBeNull();
  });

  it("shows the error message when the hook reports an error", () => {
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

  it("renders the RunsTable with all runs and correct stat counts when loaded", () => {
    const runs = [
      makeRun({ id: "r1", state: "Planning" }), // active
      makeRun({ id: "r2", state: "AwaitingPlanApproval" }), // waiting
      makeRun({ id: "r3", state: "AIBlocked" }), // blocked
      makeRun({ id: "r4", state: "Done" }), // done
      makeRun({ id: "r5", state: "Todo" }), // idle
    ];
    mockUseRuns.mockReturnValue({ runs, loading: false, error: null, refetch: vi.fn() });
    const { container } = render(<DashboardPage />);

    expect(screen.getByTestId("runs-count").textContent).toBe("5");
    // Stat tiles: query the stats grid directly since "Active"/"Blocked"/"Done"
    // also appear as filter button labels elsewhere on the page.
    const statsGrid = container.querySelector(".grid.grid-cols-5")!;
    const tileValues = Array.from(statsGrid.children).map(
      (tile) => tile.firstElementChild?.textContent,
    );
    expect(tileValues).toEqual(["5", "1", "1", "1", "1"]);
  });

  it("counts multiple runs sharing the same state category together", () => {
    const runs = [
      makeRun({ id: "r1", state: "Planning" }), // active
      makeRun({ id: "r2", state: "Implementing" }), // also active
    ];
    mockUseRuns.mockReturnValue({ runs, loading: false, error: null, refetch: vi.fn() });
    const { container } = render(<DashboardPage />);

    const statsGrid = container.querySelector(".grid.grid-cols-5")!;
    const tileValues = Array.from(statsGrid.children).map(
      (tile) => tile.firstElementChild?.textContent,
    );
    // Total=2, Active=2 (both runs), Awaiting/Blocked/Done=0
    expect(tileValues).toEqual(["2", "2", "0", "0", "0"]);
  });

  it("counts a run with an unrecognized state as idle in the stats bar", () => {
    const runs = [makeRun({ id: "r1", state: "SomeNewState" })];
    mockUseRuns.mockReturnValue({ runs, loading: false, error: null, refetch: vi.fn() });
    const { container } = render(<DashboardPage />);

    const statsGrid = container.querySelector(".grid.grid-cols-5")!;
    const tileValues = Array.from(statsGrid.children).map(
      (tile) => tile.firstElementChild?.textContent,
    );
    // Total=1, Active/Awaiting/Blocked/Done=0 (the unknown state counts as idle,
    // which has no dedicated stat tile).
    expect(tileValues).toEqual(["1", "0", "0", "0", "0"]);
  });

  it("filters the runs table by category when a filter button is clicked", () => {
    const runs = [
      makeRun({ id: "r1", state: "Planning" }), // active
      makeRun({ id: "r2", state: "Done" }), // done
    ];
    mockUseRuns.mockReturnValue({ runs, loading: false, error: null, refetch: vi.fn() });
    render(<DashboardPage />);

    expect(screen.getByTestId("runs-count").textContent).toBe("2");

    fireEvent.click(screen.getByRole("button", { name: "Done" }));
    expect(screen.getByTestId("runs-count").textContent).toBe("1");
    expect(screen.getByTestId("run-r2")).toBeDefined();
    expect(screen.queryByTestId("run-r1")).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "All" }));
    expect(screen.getByTestId("runs-count").textContent).toBe("2");
  });

  it("calls refetch when the RunsTable reports an action", () => {
    const refetch = vi.fn();
    mockUseRuns.mockReturnValue({ runs: [], loading: false, error: null, refetch });
    render(<DashboardPage />);

    fireEvent.click(screen.getByText("runs-table-action"));
    expect(refetch).toHaveBeenCalledTimes(1);
  });

  it("opens the Linear sync dialog when 'Sync from Linear' is clicked, and closes it", () => {
    mockUseRuns.mockReturnValue({ runs: [], loading: false, error: null, refetch: vi.fn() });
    render(<DashboardPage />);

    expect(screen.queryByTestId("linear-sync-dialog")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: /Sync from Linear/i }));
    expect(screen.getByTestId("linear-sync-dialog")).toBeDefined();

    fireEvent.click(screen.getByText("close-dialog"));
    expect(screen.queryByTestId("linear-sync-dialog")).toBeNull();
  });

  it("calls refetch when the sync dialog reports runs were ingested", () => {
    const refetch = vi.fn();
    mockUseRuns.mockReturnValue({ runs: [], loading: false, error: null, refetch });
    render(<DashboardPage />);

    fireEvent.click(screen.getByRole("button", { name: /Sync from Linear/i }));
    fireEvent.click(screen.getByText("ingested"));
    expect(refetch).toHaveBeenCalledTimes(1);
  });

  it("shows the ingest summary banner after a completed ingest, and allows dismissing it", () => {
    mockUseRuns.mockReturnValue({ runs: [], loading: false, error: null, refetch: vi.fn() });
    render(<DashboardPage />);

    fireEvent.click(screen.getByRole("button", { name: /Sync from Linear/i }));
    fireEvent.click(screen.getByText("complete-ingest"));

    const banner = screen.getByTestId("ingest-banner");
    expect(banner.textContent).toContain("started:2");
    expect(banner.textContent).toContain("skipped:1");

    fireEvent.click(screen.getByText("dismiss-banner"));
    expect(screen.queryByTestId("ingest-banner")).toBeNull();
  });

  it("auto-dismisses the ingest summary banner after the timeout", () => {
    vi.useFakeTimers();
    mockUseRuns.mockReturnValue({ runs: [], loading: false, error: null, refetch: vi.fn() });
    render(<DashboardPage />);

    fireEvent.click(screen.getByRole("button", { name: /Sync from Linear/i }));
    fireEvent.click(screen.getByText("complete-ingest"));
    expect(screen.getByTestId("ingest-banner")).toBeDefined();

    act(() => {
      vi.advanceTimersByTime(5000);
    });
    expect(screen.queryByTestId("ingest-banner")).toBeNull();
  });
});
