import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, act } from "@testing-library/react";
import { DashboardPage } from "./DashboardPage";
import type { Run } from "@/api/client.ts";

const mockUseRuns = vi.fn();
vi.mock("@/hooks/useRuns.ts", () => ({
  useRuns: () => mockUseRuns(),
}));

vi.mock("@/components/RunsTable.tsx", () => ({
  RunsTable: ({ runs, onAction }: { runs: Run[]; onAction?: () => void }) => (
    <div data-testid="runs-table">
      <span data-testid="runs-count">{runs.length}</span>
      <button onClick={onAction}>trigger-action</button>
    </div>
  ),
}));

vi.mock("@/components/LinearSyncDialog.tsx", () => ({
  LinearSyncDialog: ({
    open,
    onClose,
    onIngestComplete,
  }: {
    open: boolean;
    onClose: () => void;
    onIngested: () => void;
    onIngestComplete: (s: { started: number; skipped: number }) => void;
  }) =>
    open ? (
      <div data-testid="sync-dialog">
        <button onClick={onClose}>close-dialog</button>
        <button onClick={() => onIngestComplete({ started: 2, skipped: 1 })}>
          complete-ingest
        </button>
      </div>
    ) : null,
}));

vi.mock("@/components/IngestSummaryBanner.tsx", () => ({
  IngestSummaryBanner: ({
    started,
    skipped,
    onDismiss,
  }: {
    started: number;
    skipped: number;
    onDismiss: () => void;
  }) => (
    <div data-testid="ingest-banner">
      started:{started} skipped:{skipped}
      <button onClick={onDismiss}>dismiss</button>
    </div>
  ),
}));

function makeRun(overrides: Partial<Run>): Run {
  return {
    id: "run-1",
    linearIssueId: "issue-1",
    linearIssueIdentifier: "ENG-1",
    linearIssueDescription: null,
    linearIssueTitle: "Some title",
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
    workingDirectory: "/tmp",
    latestArtifactVersion: 0,
    createdAt: "2026-01-01T00:00:00Z",
    updatedAt: "2026-01-01T00:00:00Z",
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
    expect(screen.getByText("Loading runs...")).toBeTruthy();
    expect(screen.queryByTestId("runs-table")).toBeNull();
  });

  it("shows an error message when loading fails", () => {
    mockUseRuns.mockReturnValue({
      runs: [],
      loading: false,
      error: "Network error",
      refetch: vi.fn(),
    });
    render(<DashboardPage />);
    expect(screen.getByText("Network error")).toBeTruthy();
    expect(screen.queryByTestId("runs-table")).toBeNull();
  });

  it("renders the runs table and stat counts when loaded", () => {
    const runs = [
      makeRun({ id: "r1", state: "Planning" }),
      makeRun({ id: "r2", state: "Done" }),
      makeRun({ id: "r3", state: "AIBlocked" }),
    ];
    mockUseRuns.mockReturnValue({ runs, loading: false, error: null, refetch: vi.fn() });
    render(<DashboardPage />);

    expect(screen.getByTestId("runs-count").textContent).toBe("3");
    // Total stat value appears alongside the (mocked) runs count value.
    expect(screen.getAllByText("3").length).toBeGreaterThanOrEqual(2);
    expect(screen.getByText("Awaiting")).toBeTruthy();
  });

  it("filters the runs table when a filter button is clicked", () => {
    const runs = [
      makeRun({ id: "r1", state: "Planning" }), // active
      makeRun({ id: "r2", state: "Done" }), // done
    ];
    mockUseRuns.mockReturnValue({ runs, loading: false, error: null, refetch: vi.fn() });
    render(<DashboardPage />);

    expect(screen.getByTestId("runs-count").textContent).toBe("2");

    fireEvent.click(screen.getByRole("button", { name: "Done" }));
    expect(screen.getByTestId("runs-count").textContent).toBe("1");

    fireEvent.click(screen.getByRole("button", { name: "All" }));
    expect(screen.getByTestId("runs-count").textContent).toBe("2");
  });

  it("calls refetch when RunsTable triggers onAction", () => {
    const refetch = vi.fn();
    mockUseRuns.mockReturnValue({ runs: [], loading: false, error: null, refetch });
    render(<DashboardPage />);
    fireEvent.click(screen.getByText("trigger-action"));
    expect(refetch).toHaveBeenCalledTimes(1);
  });

  it("opens the Linear sync dialog when the sync button is clicked, and closes it", () => {
    mockUseRuns.mockReturnValue({ runs: [], loading: false, error: null, refetch: vi.fn() });
    render(<DashboardPage />);

    expect(screen.queryByTestId("sync-dialog")).toBeNull();
    fireEvent.click(screen.getByText("Sync from Linear"));
    expect(screen.queryByTestId("sync-dialog")).not.toBeNull();

    fireEvent.click(screen.getByText("close-dialog"));
    expect(screen.queryByTestId("sync-dialog")).toBeNull();
  });

  it("shows the ingest summary banner after onIngestComplete fires, and auto-dismisses it", () => {
    vi.useFakeTimers();
    mockUseRuns.mockReturnValue({ runs: [], loading: false, error: null, refetch: vi.fn() });
    render(<DashboardPage />);

    expect(screen.queryByTestId("ingest-banner")).toBeNull();

    fireEvent.click(screen.getByText("Sync from Linear"));
    fireEvent.click(screen.getByText("complete-ingest"));

    const banner = screen.getByTestId("ingest-banner");
    expect(banner.textContent).toContain("started:2");
    expect(banner.textContent).toContain("skipped:1");

    act(() => {
      vi.advanceTimersByTime(5000);
    });
    expect(screen.queryByTestId("ingest-banner")).toBeNull();

    vi.useRealTimers();
  });

  it("dismisses the ingest summary banner when onDismiss is clicked", () => {
    mockUseRuns.mockReturnValue({ runs: [], loading: false, error: null, refetch: vi.fn() });
    render(<DashboardPage />);

    fireEvent.click(screen.getByText("Sync from Linear"));
    fireEvent.click(screen.getByText("complete-ingest"));
    expect(screen.queryByTestId("ingest-banner")).not.toBeNull();

    fireEvent.click(screen.getByText("dismiss"));
    expect(screen.queryByTestId("ingest-banner")).toBeNull();
  });
});
