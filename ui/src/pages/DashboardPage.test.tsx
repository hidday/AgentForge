import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, act } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { Run } from "@/api/client.ts";

// Mock the hook powering the page
vi.mock("@/hooks/useRuns.ts", () => ({
  useRuns: vi.fn(),
}));

// Mock heavy/child components so this test is a pure orchestration test.
vi.mock("@/components/RunsTable.tsx", () => ({
  RunsTable: ({ runs, onAction }: { runs: Run[]; onAction?: () => void }) => (
    <div data-testid="runs-table" data-count={runs.length}>
      {runs.map((r) => (
        <div key={r.id} data-testid="runs-table-row">
          {r.id}
        </div>
      ))}
      <button onClick={() => onAction?.()}>table-action</button>
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
  }) => (
    <div data-testid="linear-sync-dialog" data-open={String(open)}>
      <button onClick={onClose}>dialog-close</button>
      <button onClick={onIngested}>dialog-ingested</button>
      <button onClick={() => onIngestComplete({ started: 2, skipped: 1 })}>
        dialog-complete
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
    <div data-testid="ingest-summary-banner">
      Started {started}, skipped {skipped}
      <button onClick={onDismiss}>banner-dismiss</button>
    </div>
  ),
}));

import { DashboardPage } from "./DashboardPage.tsx";
import { useRuns } from "@/hooks/useRuns.ts";

const mockUseRuns = useRuns as unknown as ReturnType<typeof vi.fn>;

function makeRun(overrides: Partial<Run> = {}): Run {
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
    workingDirectory: "/tmp/run-1",
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

  it("shows a loading indicator and does not render the runs table while loading", () => {
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

  it("shows an error message and does not render the runs table on error", () => {
    mockUseRuns.mockReturnValue({
      runs: [],
      loading: false,
      error: "Failed to fetch runs",
      refetch: vi.fn(),
    });

    render(<DashboardPage />);

    expect(screen.getByText("Failed to fetch runs")).toBeDefined();
    expect(screen.queryByTestId("runs-table")).toBeNull();
    expect(screen.queryByText(/loading runs/i)).toBeNull();
  });

  it("renders the runs table and correct stat counts when loaded", () => {
    const runs = [
      makeRun({ id: "r1", state: "Planning" }), // active
      makeRun({ id: "r6", state: "Implementing" }), // active (2nd, exercises the accumulator's non-empty branch)
      makeRun({ id: "r2", state: "AwaitingPlanApproval" }), // waiting
      makeRun({ id: "r3", state: "AIBlocked" }), // blocked
      makeRun({ id: "r4", state: "Done" }), // done
      makeRun({ id: "r5", state: "Todo" }), // idle (not shown as its own stat)
      makeRun({ id: "r7", state: "SomeUnmappedState" }), // falls back to "idle" via ??
    ];
    mockUseRuns.mockReturnValue({
      runs,
      loading: false,
      error: null,
      refetch: vi.fn(),
    });

    render(<DashboardPage />);

    expect(screen.getByTestId("runs-table").getAttribute("data-count")).toBe("7");
    // Total stat
    expect(screen.getByText("7")).toBeDefined();
    // Two active runs
    expect(screen.getByText("2")).toBeDefined();
    // One run in each of waiting/blocked/done
    const ones = screen.getAllByText("1");
    expect(ones.length).toBe(3);
  });

  it("filters the runs table when a filter button is clicked", async () => {
    const user = userEvent.setup();
    const runs = [
      makeRun({ id: "r1", state: "Planning" }), // active
      makeRun({ id: "r2", state: "AwaitingPlanApproval" }), // waiting
      makeRun({ id: "r3", state: "Todo" }), // idle
    ];
    mockUseRuns.mockReturnValue({
      runs,
      loading: false,
      error: null,
      refetch: vi.fn(),
    });

    render(<DashboardPage />);

    expect(screen.getByTestId("runs-table").getAttribute("data-count")).toBe("3");

    await user.click(screen.getByRole("button", { name: "Active" }));

    expect(screen.getByTestId("runs-table").getAttribute("data-count")).toBe("1");
    expect(screen.getByTestId("runs-table-row").textContent).toBe("r1");
  });

  it("opens the Linear sync dialog when the sync button is clicked, and closes it", async () => {
    const user = userEvent.setup();
    mockUseRuns.mockReturnValue({
      runs: [],
      loading: false,
      error: null,
      refetch: vi.fn(),
    });

    render(<DashboardPage />);

    expect(screen.getByTestId("linear-sync-dialog").getAttribute("data-open")).toBe(
      "false",
    );

    await user.click(screen.getByRole("button", { name: /sync from linear/i }));
    expect(screen.getByTestId("linear-sync-dialog").getAttribute("data-open")).toBe(
      "true",
    );

    await user.click(screen.getByRole("button", { name: "dialog-close" }));
    expect(screen.getByTestId("linear-sync-dialog").getAttribute("data-open")).toBe(
      "false",
    );
  });

  it("wires RunsTable's onAction and the dialog's onIngested to the refetch callback", async () => {
    const user = userEvent.setup();
    const refetch = vi.fn();
    mockUseRuns.mockReturnValue({
      runs: [],
      loading: false,
      error: null,
      refetch,
    });

    render(<DashboardPage />);

    await user.click(screen.getByRole("button", { name: "table-action" }));
    expect(refetch).toHaveBeenCalledTimes(1);

    await user.click(screen.getByRole("button", { name: "dialog-ingested" }));
    expect(refetch).toHaveBeenCalledTimes(2);
  });

  it("shows the ingest summary banner after onIngestComplete fires, and dismisses it", async () => {
    const user = userEvent.setup();
    mockUseRuns.mockReturnValue({
      runs: [],
      loading: false,
      error: null,
      refetch: vi.fn(),
    });

    render(<DashboardPage />);

    expect(screen.queryByTestId("ingest-summary-banner")).toBeNull();

    await user.click(screen.getByRole("button", { name: "dialog-complete" }));

    const banner = screen.getByTestId("ingest-summary-banner");
    expect(banner.textContent).toContain("Started 2");
    expect(banner.textContent).toContain("skipped 1");

    await user.click(screen.getByRole("button", { name: "banner-dismiss" }));
    expect(screen.queryByTestId("ingest-summary-banner")).toBeNull();
  });

  it("auto-dismisses the ingest summary banner after the timeout elapses", async () => {
    vi.useFakeTimers();
    mockUseRuns.mockReturnValue({
      runs: [],
      loading: false,
      error: null,
      refetch: vi.fn(),
    });

    render(<DashboardPage />);

    act(() => {
      fireEvent.click(screen.getByRole("button", { name: "dialog-complete" }));
    });
    expect(screen.getByTestId("ingest-summary-banner")).toBeDefined();

    act(() => {
      vi.advanceTimersByTime(5000);
    });

    expect(screen.queryByTestId("ingest-summary-banner")).toBeNull();
  });
});
