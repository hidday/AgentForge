import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { Run } from "@/api/client.ts";

const mockUseRuns = vi.fn();
vi.mock("@/hooks/useRuns.ts", () => ({
  useRuns: () => mockUseRuns(),
}));

// Capture the props RunsTable is rendered with so we can assert on the
// filtered run list without re-testing RunsTable's own internals (owned
// elsewhere).
let lastRunsTableProps: { runs: Run[]; onAction?: () => void } | null = null;
vi.mock("@/components/RunsTable.tsx", () => ({
  RunsTable: (props: { runs: Run[]; onAction?: () => void }) => {
    lastRunsTableProps = props;
    return (
      <div data-testid="runs-table">
        {props.runs.map((r) => (
          <div key={r.id} data-testid="run-row">
            {r.id}:{r.state}
          </div>
        ))}
        <button onClick={() => props.onAction?.()}>trigger-action</button>
      </div>
    );
  },
}));

let lastDialogProps: {
  open: boolean;
  onClose: () => void;
  onIngested: () => void;
  onIngestComplete?: (s: { started: number; skipped: number }) => void;
} | null = null;
vi.mock("@/components/LinearSyncDialog.tsx", () => ({
  LinearSyncDialog: (props: {
    open: boolean;
    onClose: () => void;
    onIngested: () => void;
    onIngestComplete?: (s: { started: number; skipped: number }) => void;
  }) => {
    lastDialogProps = props;
    if (!props.open) return null;
    return (
      <div data-testid="linear-sync-dialog">
        <button onClick={props.onClose}>close-dialog</button>
        <button onClick={() => props.onIngestComplete?.({ started: 3, skipped: 1 })}>
          complete-ingest
        </button>
      </div>
    );
  },
}));

import { DashboardPage } from "./DashboardPage.tsx";

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
    workingDirectory: "/tmp",
    latestArtifactVersion: 1,
    createdAt: "2024-01-01T00:00:00Z",
    updatedAt: "2024-01-01T00:00:00Z",
  };
}

describe("DashboardPage", () => {
  beforeEach(() => {
    lastRunsTableProps = null;
    lastDialogProps = null;
    mockUseRuns.mockReset();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("shows a loading state and does not render the runs table", () => {
    mockUseRuns.mockReturnValue({ runs: [], loading: true, error: null, refetch: vi.fn() });

    render(<DashboardPage />);

    expect(screen.getByText(/loading runs/i)).toBeDefined();
    expect(screen.queryByTestId("runs-table")).toBeNull();
  });

  it("shows an error state and does not render the runs table", () => {
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

  it("renders the runs table and correct stat counts when loaded successfully", () => {
    const runs = [
      makeRun("r1", "Implementing"), // active
      makeRun("r2", "AwaitingPlanApproval"), // waiting
      makeRun("r3", "AIBlocked"), // blocked
      makeRun("r4", "Done"), // done
      makeRun("r5", "Todo"), // idle (not in any stat bucket but counted in Total)
    ];
    mockUseRuns.mockReturnValue({ runs, loading: false, error: null, refetch: vi.fn() });

    render(<DashboardPage />);

    expect(screen.getByTestId("runs-table")).toBeDefined();
    expect(screen.getAllByTestId("run-row")).toHaveLength(5);

    // Stats bar: Total/Active/Awaiting/Blocked/Done counts.
    expect(screen.getByText("Total")).toBeDefined();
    const statValues = screen.getAllByText(/^[0-9]+$/).map((el) => el.textContent);
    expect(statValues).toEqual(["5", "1", "1", "1", "1"]);
  });

  it("counts a run with an unrecognized state as idle rather than throwing", () => {
    const runs = [makeRun("r1", "SomeFutureUnknownState")];
    mockUseRuns.mockReturnValue({ runs, loading: false, error: null, refetch: vi.fn() });

    render(<DashboardPage />);

    // Total is 1; none of the four tracked buckets (active/waiting/blocked/done)
    // count it, since it falls back to the untracked "idle" category.
    const statValues = screen.getAllByText(/^[0-9]+$/).map((el) => el.textContent);
    expect(statValues).toEqual(["1", "0", "0", "0", "0"]);
  });

  it("filters the runs table by state category when a filter button is clicked", async () => {
    const runs = [
      makeRun("r1", "Implementing"), // active
      makeRun("r2", "AwaitingPlanApproval"), // waiting
      makeRun("r3", "Done"), // done
    ];
    mockUseRuns.mockReturnValue({ runs, loading: false, error: null, refetch: vi.fn() });

    render(<DashboardPage />);

    expect(screen.getAllByTestId("run-row")).toHaveLength(3);

    await userEvent.click(screen.getByRole("button", { name: "Active" }));

    expect(screen.getAllByTestId("run-row")).toHaveLength(1);
    expect(screen.getByText("r1:Implementing")).toBeDefined();

    await userEvent.click(screen.getByRole("button", { name: "Done" }));
    expect(screen.getAllByTestId("run-row")).toHaveLength(1);
    expect(screen.getByText("r3:Done")).toBeDefined();

    await userEvent.click(screen.getByRole("button", { name: "All" }));
    expect(screen.getAllByTestId("run-row")).toHaveLength(3);
  });

  it("passes refetch as RunsTable's onAction so row actions refresh the dashboard", async () => {
    const refetch = vi.fn();
    mockUseRuns.mockReturnValue({
      runs: [makeRun("r1", "Implementing")],
      loading: false,
      error: null,
      refetch,
    });

    render(<DashboardPage />);

    await userEvent.click(screen.getByRole("button", { name: "trigger-action" }));
    expect(refetch).toHaveBeenCalledOnce();
    expect(lastRunsTableProps?.onAction).toBe(refetch);
  });

  it("opens the Linear sync dialog when 'Sync from Linear' is clicked, and closes it", async () => {
    mockUseRuns.mockReturnValue({ runs: [], loading: false, error: null, refetch: vi.fn() });

    render(<DashboardPage />);

    expect(screen.queryByTestId("linear-sync-dialog")).toBeNull();
    expect(lastDialogProps?.open).toBe(false);

    await userEvent.click(screen.getByRole("button", { name: /sync from linear/i }));

    expect(screen.getByTestId("linear-sync-dialog")).toBeDefined();

    await userEvent.click(screen.getByRole("button", { name: "close-dialog" }));
    expect(screen.queryByTestId("linear-sync-dialog")).toBeNull();
  });

  it("shows the ingest summary banner after a successful ingest, with correct started/skipped counts", async () => {
    mockUseRuns.mockReturnValue({ runs: [], loading: false, error: null, refetch: vi.fn() });

    render(<DashboardPage />);

    await userEvent.click(screen.getByRole("button", { name: /sync from linear/i }));
    await userEvent.click(screen.getByRole("button", { name: "complete-ingest" }));

    const banner = screen.getByRole("status");
    expect(banner.textContent).toContain("Started 3 runs");
    expect(banner.textContent).toContain("skipped 1");
  });

  it("auto-dismisses the ingest summary banner after the timeout elapses", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    mockUseRuns.mockReturnValue({ runs: [], loading: false, error: null, refetch: vi.fn() });

    render(<DashboardPage />);

    await user.click(screen.getByRole("button", { name: /sync from linear/i }));
    await user.click(screen.getByRole("button", { name: "complete-ingest" }));

    expect(screen.getByRole("status")).toBeDefined();

    await vi.advanceTimersByTimeAsync(5000);

    await waitFor(() => {
      expect(screen.queryByRole("status")).toBeNull();
    });
  });

  it("dismisses the ingest summary banner immediately when its dismiss button is clicked", async () => {
    mockUseRuns.mockReturnValue({ runs: [], loading: false, error: null, refetch: vi.fn() });

    render(<DashboardPage />);

    await userEvent.click(screen.getByRole("button", { name: /sync from linear/i }));
    await userEvent.click(screen.getByRole("button", { name: "complete-ingest" }));

    const banner = screen.getByRole("status");
    const dismissBtn = screen.getByRole("button", { name: /dismiss/i });
    await userEvent.click(dismissBtn);

    expect(screen.queryByRole("status")).toBeNull();
    expect(banner).toBeDefined();
  });
});
