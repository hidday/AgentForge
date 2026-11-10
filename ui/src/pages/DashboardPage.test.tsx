import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, within, act, fireEvent } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { Run } from "@/api/client.ts";

vi.mock("@/hooks/useRuns.ts", () => ({
  useRuns: vi.fn(),
}));

vi.mock("@/components/RunsTable.tsx", () => ({
  RunsTable: ({ runs, onAction }: { runs: Run[]; onAction?: () => void }) => (
    <div data-testid="runs-table">
      <span data-testid="runs-count">{runs.length}</span>
      <button onClick={onAction}>table-action</button>
    </div>
  ),
}));

vi.mock("@/components/LinearSyncDialog.tsx", () => ({
  LinearSyncDialog: ({
    open,
    onClose,
    onIngested,
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
        <button onClick={onIngested}>mark-ingested</button>
        <button onClick={() => onIngestComplete({ started: 3, skipped: 1 })}>
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
      <span>{`${started}/${skipped}`}</span>
      <button onClick={onDismiss}>dismiss-banner</button>
    </div>
  ),
}));

import { useRuns } from "@/hooks/useRuns.ts";
import { DashboardPage } from "./DashboardPage";

const mockUseRuns = useRuns as unknown as ReturnType<typeof vi.fn>;

function makeRun(overrides: Partial<Run> = {}): Run {
  return {
    id: "run-1",
    linearIssueId: "li-1",
    linearIssueIdentifier: null,
    linearIssueDescription: null,
    linearIssueTitle: null,
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
    createdAt: "2024-01-01T00:00:00.000Z",
    updatedAt: "2024-01-01T00:00:00.000Z",
    ...overrides,
  };
}

describe("DashboardPage", () => {
  const refetch = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("shows a loading indicator and no table while loading", () => {
    mockUseRuns.mockReturnValue({ runs: [], loading: true, error: null, refetch });
    render(<DashboardPage />);
    expect(screen.getByText(/loading runs/i)).toBeDefined();
    expect(screen.queryByTestId("runs-table")).toBeNull();
  });

  it("shows an error message and no table on error", () => {
    mockUseRuns.mockReturnValue({
      runs: [],
      loading: false,
      error: "Could not reach server",
      refetch,
    });
    render(<DashboardPage />);
    expect(screen.getByText("Could not reach server")).toBeDefined();
    expect(screen.queryByTestId("runs-table")).toBeNull();
  });

  it("renders the RunsTable with all runs when filter is 'all'", () => {
    const runs = [
      makeRun({ id: "r1", state: "Planning" }),
      makeRun({ id: "r2", state: "Done" }),
    ];
    mockUseRuns.mockReturnValue({ runs, loading: false, error: null, refetch });
    render(<DashboardPage />);
    expect(screen.getByTestId("runs-count").textContent).toBe("2");
  });

  it("computes stats-bar counts per state category", () => {
    const runs = [
      makeRun({ id: "r1", state: "Planning" }), // active
      makeRun({ id: "r2", state: "Implementing" }), // active
      makeRun({ id: "r3", state: "AwaitingPlanApproval" }), // waiting
      makeRun({ id: "r4", state: "AIBlocked" }), // blocked
      makeRun({ id: "r5", state: "Done" }), // done
    ];
    mockUseRuns.mockReturnValue({ runs, loading: false, error: null, refetch });
    render(<DashboardPage />);

    // "Active"/"Blocked"/"Done" labels also appear as filter-button text, so the
    // stats-bar label (always the first match in DOM order) is picked explicitly.
    expect(screen.getByText("Total").previousSibling?.textContent).toBe("5");
    expect(screen.getAllByText("Active")[0].previousSibling?.textContent).toBe("2");
    expect(screen.getByText("Awaiting").previousSibling?.textContent).toBe("1");
    expect(screen.getAllByText("Blocked")[0].previousSibling?.textContent).toBe("1");
    expect(screen.getAllByText("Done")[0].previousSibling?.textContent).toBe("1");
  });

  it("filters the runs passed to RunsTable when a filter button is clicked", async () => {
    const runs = [
      makeRun({ id: "r1", state: "Planning" }), // active
      makeRun({ id: "r2", state: "Done" }), // done
    ];
    mockUseRuns.mockReturnValue({ runs, loading: false, error: null, refetch });
    render(<DashboardPage />);

    expect(screen.getByTestId("runs-count").textContent).toBe("2");

    await userEvent.click(screen.getByRole("button", { name: "Done" }));
    expect(screen.getByTestId("runs-count").textContent).toBe("1");

    await userEvent.click(screen.getByRole("button", { name: "Active" }));
    expect(screen.getByTestId("runs-count").textContent).toBe("1");

    await userEvent.click(screen.getByRole("button", { name: "All" }));
    expect(screen.getByTestId("runs-count").textContent).toBe("2");
  });

  it("filters runs with an unmapped state into no category (excluded from active/waiting/etc.)", async () => {
    const runs = [makeRun({ id: "r1", state: "SomeUnknownState" })];
    mockUseRuns.mockReturnValue({ runs, loading: false, error: null, refetch });
    render(<DashboardPage />);

    await userEvent.click(screen.getByRole("button", { name: "Blocked" }));
    expect(screen.getByTestId("runs-count").textContent).toBe("0");
  });

  it("forwards RunsTable's onAction to the hook's refetch", async () => {
    mockUseRuns.mockReturnValue({ runs: [], loading: false, error: null, refetch });
    render(<DashboardPage />);
    await userEvent.click(screen.getByRole("button", { name: "table-action" }));
    expect(refetch).toHaveBeenCalledTimes(1);
  });

  it("opens the LinearSyncDialog when 'Sync from Linear' is clicked, and closes it", async () => {
    mockUseRuns.mockReturnValue({ runs: [], loading: false, error: null, refetch });
    render(<DashboardPage />);

    expect(screen.queryByTestId("sync-dialog")).toBeNull();
    await userEvent.click(screen.getByRole("button", { name: /sync from linear/i }));
    expect(screen.getByTestId("sync-dialog")).toBeDefined();

    await userEvent.click(screen.getByRole("button", { name: "close-dialog" }));
    expect(screen.queryByTestId("sync-dialog")).toBeNull();
  });

  it("refetches runs when the dialog reports runs were ingested", async () => {
    mockUseRuns.mockReturnValue({ runs: [], loading: false, error: null, refetch });
    render(<DashboardPage />);
    await userEvent.click(screen.getByRole("button", { name: /sync from linear/i }));
    await userEvent.click(screen.getByRole("button", { name: "mark-ingested" }));
    expect(refetch).toHaveBeenCalledTimes(1);
  });

  it("shows the ingest summary banner after ingestion completes, with correct counts", async () => {
    mockUseRuns.mockReturnValue({ runs: [], loading: false, error: null, refetch });
    render(<DashboardPage />);
    await userEvent.click(screen.getByRole("button", { name: /sync from linear/i }));
    await userEvent.click(screen.getByRole("button", { name: "complete-ingest" }));

    const banner = screen.getByTestId("ingest-banner");
    expect(within(banner).getByText("3/1")).toBeDefined();
  });

  it("dismisses the ingest summary banner when onDismiss is invoked", async () => {
    mockUseRuns.mockReturnValue({ runs: [], loading: false, error: null, refetch });
    render(<DashboardPage />);
    await userEvent.click(screen.getByRole("button", { name: /sync from linear/i }));
    await userEvent.click(screen.getByRole("button", { name: "complete-ingest" }));
    expect(screen.getByTestId("ingest-banner")).toBeDefined();

    await userEvent.click(screen.getByRole("button", { name: "dismiss-banner" }));
    expect(screen.queryByTestId("ingest-banner")).toBeNull();
  });

  it("auto-dismisses the ingest summary banner after the timeout", async () => {
    vi.useFakeTimers();
    mockUseRuns.mockReturnValue({ runs: [], loading: false, error: null, refetch });
    render(<DashboardPage />);

    fireEvent.click(screen.getByRole("button", { name: /sync from linear/i }));
    fireEvent.click(screen.getByRole("button", { name: "complete-ingest" }));
    expect(screen.getByTestId("ingest-banner")).toBeDefined();

    act(() => {
      vi.advanceTimersByTime(5000);
    });
    expect(screen.queryByTestId("ingest-banner")).toBeNull();
  });
});
