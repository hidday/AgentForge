import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { Run } from "@/api/client.ts";

// Mock the data hook — DashboardPage's own logic (filtering, stat counts,
// loading/error branches, ingest-summary lifecycle) is what this file
// targets, not the data-fetching hook itself.
vi.mock("@/hooks/useRuns.ts", () => ({
  useRuns: vi.fn(),
}));

// Capture props passed to RunsTable so we can assert on the filtered list
// without rendering the full table (which needs a Router for its <Link>s).
let lastRunsTableProps: { runs: Run[]; onAction?: () => void } | null = null;
vi.mock("@/components/RunsTable.tsx", () => ({
  RunsTable: (props: { runs: Run[]; onAction?: () => void }) => {
    lastRunsTableProps = props;
    return (
      <div data-testid="runs-table">
        {props.runs.map((r) => r.id).join(",")}
      </div>
    );
  },
}));

let lastSyncDialogProps:
  | {
      open: boolean;
      onClose: () => void;
      onIngested: () => void;
      onIngestComplete?: (s: { started: number; skipped: number }) => void;
    }
  | null = null;
vi.mock("@/components/LinearSyncDialog.tsx", () => ({
  LinearSyncDialog: (props: {
    open: boolean;
    onClose: () => void;
    onIngested: () => void;
    onIngestComplete?: (s: { started: number; skipped: number }) => void;
  }) => {
    lastSyncDialogProps = props;
    return (
      <div data-testid="linear-sync-dialog" data-open={String(props.open)}>
        <button onClick={props.onClose}>mock-close</button>
        <button onClick={props.onIngested}>mock-ingested</button>
        <button onClick={() => props.onIngestComplete?.({ started: 3, skipped: 1 })}>
          mock-complete
        </button>
      </div>
    );
  },
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

import { DashboardPage } from "./DashboardPage.tsx";
import { useRuns } from "@/hooks/useRuns.ts";

const mockUseRuns = useRuns as unknown as ReturnType<typeof vi.fn>;

function makeRun(id: string, state: string): Run {
  return {
    id,
    linearIssueId: `issue-${id}`,
    linearIssueIdentifier: null,
    linearIssueDescription: null,
    linearIssueTitle: null,
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
    workingDirectory: "/tmp/x",
    latestArtifactVersion: 1,
    createdAt: "2024-01-01T00:00:00Z",
    updatedAt: "2024-01-01T00:00:00Z",
  };
}

describe("DashboardPage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    lastRunsTableProps = null;
    lastSyncDialogProps = null;
    mockUseRuns.mockReturnValue({
      runs: [],
      loading: false,
      error: null,
      refetch: vi.fn(),
    });
  });

  it("shows the loading spinner and does not render the runs table while loading", () => {
    mockUseRuns.mockReturnValue({
      runs: [],
      loading: true,
      error: null,
      refetch: vi.fn(),
    });

    render(<DashboardPage />);

    expect(screen.getByText(/loading runs/i)).toBeDefined();
    expect(screen.queryByTestId("runs-table")).toBeNull();
  });

  it("shows the error message and does not render the runs table on error", () => {
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

  it("computes stat counts per state category and renders all runs under the 'All' filter", () => {
    const runs = [
      makeRun("r1", "Implementing"), // active
      makeRun("r2", "AwaitingPlanApproval"), // waiting
      makeRun("r3", "AIBlocked"), // blocked
      makeRun("r4", "Done"), // done
      makeRun("r5", "Todo"), // idle — not shown in the stats bar
    ];
    mockUseRuns.mockReturnValue({ runs, loading: false, error: null, refetch: vi.fn() });

    render(<DashboardPage />);

    expect(screen.getByText("5").parentElement?.textContent).toContain("Total");
    expect(lastRunsTableProps?.runs.map((r) => r.id)).toEqual([
      "r1",
      "r2",
      "r3",
      "r4",
      "r5",
    ]);
  });

  it("falls back to the 'idle' category for a state not in STATE_CATEGORY_MAP, without crashing", () => {
    const runs = [
      makeRun("r1", "Implementing"), // active
      makeRun("r2", "SomeFutureUnmappedState"), // falls back to idle
    ];
    mockUseRuns.mockReturnValue({ runs, loading: false, error: null, refetch: vi.fn() });

    render(<DashboardPage />);

    expect(screen.getByText("2").parentElement?.textContent).toContain("Total");
    // The unmapped-state run is excluded from every named (non-"all") filter,
    // same as an explicit "idle" state would be.
    expect(lastRunsTableProps?.runs.map((r) => r.id)).toEqual(["r1", "r2"]);
  });

  it("filters the runs passed to RunsTable when a category filter is clicked", async () => {
    const runs = [
      makeRun("r1", "Implementing"), // active
      makeRun("r2", "AwaitingPlanApproval"), // waiting
      makeRun("r3", "Todo"), // idle — excluded from every non-'all' filter
    ];
    mockUseRuns.mockReturnValue({ runs, loading: false, error: null, refetch: vi.fn() });

    render(<DashboardPage />);

    await userEvent.click(screen.getByRole("button", { name: "Active" }));

    expect(lastRunsTableProps?.runs.map((r) => r.id)).toEqual(["r1"]);

    await userEvent.click(screen.getByRole("button", { name: "Blocked" }));
    expect(lastRunsTableProps?.runs.map((r) => r.id)).toEqual([]);

    await userEvent.click(screen.getByRole("button", { name: "All" }));
    expect(lastRunsTableProps?.runs.map((r) => r.id)).toEqual(["r1", "r2", "r3"]);
  });

  it("opens the Linear sync dialog when 'Sync from Linear' is clicked and closes it via onClose", async () => {
    render(<DashboardPage />);

    expect(lastSyncDialogProps?.open).toBe(false);

    await userEvent.click(screen.getByRole("button", { name: /sync from linear/i }));
    expect(lastSyncDialogProps?.open).toBe(true);

    await userEvent.click(screen.getByText("mock-close"));
    expect(lastSyncDialogProps?.open).toBe(false);
  });

  it("calls refetch when the dialog reports onIngested", async () => {
    const refetch = vi.fn();
    mockUseRuns.mockReturnValue({ runs: [], loading: false, error: null, refetch });

    render(<DashboardPage />);

    await userEvent.click(screen.getByText("mock-ingested"));
    expect(refetch).toHaveBeenCalledOnce();
  });

  it("shows the ingest summary banner after onIngestComplete fires, and auto-dismisses it after the timeout", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });

    render(<DashboardPage />);

    await user.click(screen.getByText("mock-complete"));

    expect(screen.getByTestId("ingest-banner").textContent).toContain("started:3");
    expect(screen.getByTestId("ingest-banner").textContent).toContain("skipped:1");

    await vi.advanceTimersByTimeAsync(5000);

    await waitFor(() => {
      expect(screen.queryByTestId("ingest-banner")).toBeNull();
    });

    vi.useRealTimers();
  });

  it("dismisses the ingest summary banner immediately when its dismiss button is clicked", async () => {
    render(<DashboardPage />);

    await userEvent.click(screen.getByText("mock-complete"));
    expect(screen.getByTestId("ingest-banner")).toBeDefined();

    await userEvent.click(screen.getByText("dismiss-banner"));
    expect(screen.queryByTestId("ingest-banner")).toBeNull();
  });
});
