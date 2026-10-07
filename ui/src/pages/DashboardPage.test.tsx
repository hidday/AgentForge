import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, within, fireEvent, act } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { Run } from "@/api/client.ts";

vi.mock("@/hooks/useRuns.ts", () => ({
  useRuns: vi.fn(),
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
    onIngestComplete,
  }: {
    open: boolean;
    onIngestComplete: (s: { started: number; skipped: number }) => void;
  }) => (
    <div data-testid="sync-dialog">
      <span data-testid="sync-dialog-state">{open ? "open" : "closed"}</span>
      <button onClick={() => onIngestComplete({ started: 3, skipped: 1 })}>
        trigger-ingest-complete
      </button>
    </div>
  ),
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
      {started}/{skipped}
      <button onClick={onDismiss}>dismiss-banner</button>
    </div>
  ),
}));

import { DashboardPage } from "./DashboardPage";
import { useRuns } from "@/hooks/useRuns.ts";

const mockUseRuns = useRuns as unknown as ReturnType<typeof vi.fn>;

function makeRun(id: string, state: string): Run {
  return {
    id,
    linearIssueId: "li-1",
    linearIssueIdentifier: "ENG-1",
    linearIssueDescription: null,
    linearIssueTitle: "Title",
    linearIssueUrl: null,
    repo: "org/repo",
    branchName: null,
    prNumber: null,
    state,
    planVersion: 1,
    approvedPlanVersion: null,
    plannerRuntime: null,
    executorRuntime: null,
    reviewerRuntime: null,
    remediationRuntime: null,
    workingDirectory: "/tmp",
    latestArtifactVersion: 1,
    createdAt: "2026-01-01T00:00:00Z",
    updatedAt: "2026-01-01T00:00:00Z",
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

  it("shows an error message when the fetch failed", () => {
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

  it("renders the runs table with the populated run list", () => {
    const runs = [makeRun("r1", "Todo"), makeRun("r2", "Done")];
    mockUseRuns.mockReturnValue({ runs, loading: false, error: null, refetch: vi.fn() });
    render(<DashboardPage />);
    expect(screen.getByTestId("runs-count").textContent).toBe("2");
  });

  it("renders the runs table (empty) when there are no runs", () => {
    mockUseRuns.mockReturnValue({ runs: [], loading: false, error: null, refetch: vi.fn() });
    render(<DashboardPage />);
    expect(screen.getByTestId("runs-table")).toBeDefined();
    expect(screen.getByTestId("runs-count").textContent).toBe("0");
  });

  it("computes stat bar counts per state category", () => {
    const runs = [
      makeRun("r1", "Planning"), // active
      makeRun("r2", "AwaitingPlanApproval"), // waiting
      makeRun("r3", "AIBlocked"), // blocked
      makeRun("r4", "Done"), // done
      makeRun("r5", "Todo"), // idle, not shown in stat bar
    ];
    mockUseRuns.mockReturnValue({ runs, loading: false, error: null, refetch: vi.fn() });
    const { container } = render(<DashboardPage />);

    // Scope to the stat bar grid alone — the filter bar below it reuses labels
    // like "Active", "Blocked" and "Done" as button text.
    const statGrid = container.querySelector(".grid.grid-cols-5") as HTMLElement;
    const stats = within(statGrid);

    expect(stats.getByText("Total").previousSibling?.textContent).toBe("5");
    expect(stats.getByText("Active").previousSibling?.textContent).toBe("1");
    expect(stats.getByText("Awaiting").previousSibling?.textContent).toBe("1");
    expect(stats.getByText("Blocked").previousSibling?.textContent).toBe("1");
    expect(stats.getByText("Done").previousSibling?.textContent).toBe("1");
  });

  it("filters the run list when a filter button is clicked", async () => {
    const runs = [makeRun("r1", "Done"), makeRun("r2", "Todo")];
    mockUseRuns.mockReturnValue({ runs, loading: false, error: null, refetch: vi.fn() });
    render(<DashboardPage />);

    expect(screen.getByTestId("runs-count").textContent).toBe("2");

    await userEvent.click(screen.getByRole("button", { name: "Done" }));
    expect(screen.getByTestId("runs-count").textContent).toBe("1");
  });

  it("opens the Linear sync dialog when 'Sync from Linear' is clicked", async () => {
    mockUseRuns.mockReturnValue({ runs: [], loading: false, error: null, refetch: vi.fn() });
    render(<DashboardPage />);

    expect(screen.getByTestId("sync-dialog-state").textContent).toBe("closed");
    await userEvent.click(screen.getByRole("button", { name: /sync from linear/i }));
    expect(screen.getByTestId("sync-dialog-state").textContent).toBe("open");
  });

  it("calls refetch when the runs table triggers onAction", async () => {
    const refetch = vi.fn();
    mockUseRuns.mockReturnValue({ runs: [], loading: false, error: null, refetch });
    render(<DashboardPage />);

    await userEvent.click(screen.getByRole("button", { name: "trigger-action" }));
    expect(refetch).toHaveBeenCalled();
  });

  it("does not show the ingest summary banner by default", () => {
    mockUseRuns.mockReturnValue({ runs: [], loading: false, error: null, refetch: vi.fn() });
    render(<DashboardPage />);
    expect(screen.queryByTestId("ingest-banner")).toBeNull();
  });

  it("shows the ingest summary banner after an ingest completes, then auto-dismisses it", () => {
    vi.useFakeTimers();
    try {
      mockUseRuns.mockReturnValue({ runs: [], loading: false, error: null, refetch: vi.fn() });
      render(<DashboardPage />);

      act(() => {
        fireEvent.click(screen.getByRole("button", { name: "trigger-ingest-complete" }));
      });
      expect(screen.getByTestId("ingest-banner").textContent).toContain("3/1");

      act(() => {
        vi.advanceTimersByTime(5000);
      });
      expect(screen.queryByTestId("ingest-banner")).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });

  it("dismisses the ingest summary banner immediately when onDismiss is invoked", () => {
    mockUseRuns.mockReturnValue({ runs: [], loading: false, error: null, refetch: vi.fn() });
    render(<DashboardPage />);

    fireEvent.click(screen.getByRole("button", { name: "trigger-ingest-complete" }));
    expect(screen.getByTestId("ingest-banner")).toBeDefined();

    fireEvent.click(screen.getByRole("button", { name: "dismiss-banner" }));
    expect(screen.queryByTestId("ingest-banner")).toBeNull();
  });
});
