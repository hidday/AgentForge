import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, act } from "@testing-library/react";
import type { Run } from "@/api/client.ts";

const mockUseRuns = vi.fn();
vi.mock("@/hooks/useRuns.ts", () => ({
  useRuns: (...args: unknown[]) => mockUseRuns(...args),
}));

vi.mock("@/components/RunsTable.tsx", () => ({
  RunsTable: ({ runs, onAction }: { runs: Run[]; onAction?: () => void }) => (
    <div data-testid="runs-table">
      <span data-testid="runs-count">{runs.length}</span>
      {runs.map((r) => (
        <span key={r.id} data-testid="run-row">
          {r.id}
        </span>
      ))}
      <button onClick={onAction}>trigger-action</button>
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
        <button onClick={onIngested}>fire-ingested</button>
        <button onClick={() => onIngestComplete({ started: 2, skipped: 1 })}>
          fire-ingest-complete
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
      <button onClick={onDismiss}>dismiss-banner</button>
    </div>
  ),
}));

import { DashboardPage } from "./DashboardPage";

function makeRun(overrides: Partial<Run>): Run {
  return {
    id: "r1",
    linearIssueId: "li1",
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
    createdAt: "2024-01-01T00:00:00Z",
    updatedAt: "2024-01-01T00:00:00Z",
    ...overrides,
  };
}

describe("DashboardPage", () => {
  beforeEach(() => {
    mockUseRuns.mockReset();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("shows a loading indicator while runs are loading", () => {
    mockUseRuns.mockReturnValue({ runs: [], loading: true, error: null, refetch: vi.fn() });
    render(<DashboardPage />);
    expect(screen.getByText(/loading runs/i)).toBeDefined();
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
    expect(screen.getByText("Network error")).toBeDefined();
    expect(screen.queryByTestId("runs-table")).toBeNull();
  });

  it("renders the runs table with all runs when not loading/error", () => {
    const runs = [makeRun({ id: "r1", state: "Todo" }), makeRun({ id: "r2", state: "Done" })];
    mockUseRuns.mockReturnValue({ runs, loading: false, error: null, refetch: vi.fn() });
    render(<DashboardPage />);
    expect(screen.getByTestId("runs-count").textContent).toBe("2");
  });

  it("computes and displays per-category stats counts", () => {
    const runs = [
      makeRun({ id: "r1", state: "Planning" }), // active
      makeRun({ id: "r2", state: "Implementing" }), // active
      makeRun({ id: "r3", state: "AwaitingPlanApproval" }), // waiting
      makeRun({ id: "r4", state: "Done" }), // done
      makeRun({ id: "r5", state: "AIBlocked" }), // blocked
    ];
    mockUseRuns.mockReturnValue({ runs, loading: false, error: null, refetch: vi.fn() });
    const { container } = render(<DashboardPage />);

    const statLabels = Array.from(
      container.querySelectorAll(".text-xs.text-text-muted.mt-0\\.5"),
    ).map((el) => el.textContent);
    const statValues = Array.from(
      container.querySelectorAll(".text-2xl.font-semibold.tabular-nums"),
    ).map((el) => el.textContent);

    expect(statLabels).toEqual(["Total", "Active", "Awaiting", "Blocked", "Done"]);
    expect(statValues).toEqual(["5", "2", "1", "1", "1"]);
  });

  it("filters the visible runs when a filter tab is clicked", () => {
    const runs = [
      makeRun({ id: "r1", state: "Planning" }), // active
      makeRun({ id: "r2", state: "Done" }), // done
    ];
    mockUseRuns.mockReturnValue({ runs, loading: false, error: null, refetch: vi.fn() });
    render(<DashboardPage />);

    expect(screen.getByTestId("runs-count").textContent).toBe("2");

    fireEvent.click(screen.getByRole("button", { name: "Done" }));
    expect(screen.getByTestId("runs-count").textContent).toBe("1");
    expect(screen.getByText("r2")).toBeDefined();

    fireEvent.click(screen.getByRole("button", { name: "All" }));
    expect(screen.getByTestId("runs-count").textContent).toBe("2");
  });

  it("treats an unmapped run state as 'idle' and excludes it from named filters", () => {
    const runs = [makeRun({ id: "r1", state: "SomeWeirdState" })];
    mockUseRuns.mockReturnValue({ runs, loading: false, error: null, refetch: vi.fn() });
    render(<DashboardPage />);

    fireEvent.click(screen.getByRole("button", { name: "Active" }));
    expect(screen.getByTestId("runs-count").textContent).toBe("0");
  });

  it("opens the Linear sync dialog when 'Sync from Linear' is clicked, and closes it", () => {
    mockUseRuns.mockReturnValue({ runs: [], loading: false, error: null, refetch: vi.fn() });
    render(<DashboardPage />);

    expect(screen.queryByTestId("sync-dialog")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: /sync from linear/i }));
    expect(screen.getByTestId("sync-dialog")).toBeDefined();

    fireEvent.click(screen.getByRole("button", { name: "close-dialog" }));
    expect(screen.queryByTestId("sync-dialog")).toBeNull();
  });

  it("calls refetch when the sync dialog reports runs were ingested", () => {
    const refetch = vi.fn();
    mockUseRuns.mockReturnValue({ runs: [], loading: false, error: null, refetch });
    render(<DashboardPage />);

    fireEvent.click(screen.getByRole("button", { name: /sync from linear/i }));
    fireEvent.click(screen.getByRole("button", { name: "fire-ingested" }));

    expect(refetch).toHaveBeenCalledTimes(1);
  });

  it("calls refetch when a run row action fires", () => {
    const refetch = vi.fn();
    mockUseRuns.mockReturnValue({
      runs: [makeRun({ id: "r1" })],
      loading: false,
      error: null,
      refetch,
    });
    render(<DashboardPage />);

    fireEvent.click(screen.getByRole("button", { name: "trigger-action" }));
    expect(refetch).toHaveBeenCalledTimes(1);
  });

  it("shows the ingest summary banner after an ingest completes and auto-dismisses it", () => {
    vi.useFakeTimers();
    mockUseRuns.mockReturnValue({ runs: [], loading: false, error: null, refetch: vi.fn() });
    render(<DashboardPage />);

    fireEvent.click(screen.getByRole("button", { name: /sync from linear/i }));
    fireEvent.click(screen.getByRole("button", { name: "fire-ingest-complete" }));

    expect(screen.getByTestId("ingest-banner").textContent).toContain("started:2");
    expect(screen.getByTestId("ingest-banner").textContent).toContain("skipped:1");

    act(() => {
      vi.advanceTimersByTime(5000);
    });
    expect(screen.queryByTestId("ingest-banner")).toBeNull();
  });

  it("dismisses the ingest summary banner manually", () => {
    mockUseRuns.mockReturnValue({ runs: [], loading: false, error: null, refetch: vi.fn() });
    render(<DashboardPage />);

    fireEvent.click(screen.getByRole("button", { name: /sync from linear/i }));
    fireEvent.click(screen.getByRole("button", { name: "fire-ingest-complete" }));
    expect(screen.getByTestId("ingest-banner")).toBeDefined();

    fireEvent.click(screen.getByRole("button", { name: "dismiss-banner" }));
    expect(screen.queryByTestId("ingest-banner")).toBeNull();
  });
});
