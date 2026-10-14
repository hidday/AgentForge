import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, act } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { Run } from "@/api/client.ts";

vi.mock("@/hooks/useRuns.ts", () => ({
  useRuns: vi.fn(),
}));

vi.mock("@/components/RunsTable.tsx", () => ({
  RunsTable: ({ runs, onAction }: { runs: Run[]; onAction?: () => void }) => (
    <div data-testid="runs-table">
      <span data-testid="runs-table-ids">{runs.map((r) => r.id).join(",")}</span>
      <button onClick={onAction}>trigger-table-action</button>
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
    onIngestComplete?: (s: { started: number; skipped: number }) => void;
  }) =>
    open ? (
      <div data-testid="sync-dialog">
        <button onClick={onClose}>close-dialog</button>
        <button onClick={onIngested}>trigger-ingested</button>
        <button onClick={() => onIngestComplete?.({ started: 2, skipped: 1 })}>
          trigger-ingest-complete
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
      Started {started}, skipped {skipped}
      <button onClick={onDismiss}>dismiss-banner</button>
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
    linearIssueTitle: "Fix the thing",
    linearIssueUrl: null,
    repo: "acme/widgets",
    branchName: null,
    prNumber: null,
    state: "Implementing",
    planVersion: 1,
    approvedPlanVersion: null,
    plannerRuntime: null,
    executorRuntime: null,
    reviewerRuntime: null,
    remediationRuntime: null,
    workingDirectory: "/tmp/run-1",
    latestArtifactVersion: 1,
    createdAt: "2024-01-01T00:00:00Z",
    updatedAt: "2024-01-01T01:00:00Z",
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

  it("shows the error message when fetching runs fails", () => {
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

  it("renders the stats bar with correct per-category counts", () => {
    mockUseRuns.mockReturnValue({
      runs: [
        makeRun({ id: "r1", state: "Implementing" }), // active
        makeRun({ id: "r2", state: "AwaitingPlanApproval" }), // waiting
        makeRun({ id: "r3", state: "AIBlocked" }), // blocked
        makeRun({ id: "r4", state: "Done" }), // done
        makeRun({ id: "r5", state: "Todo" }), // idle
      ],
      loading: false,
      error: null,
      refetch: vi.fn(),
    });
    render(<DashboardPage />);

    const stats = screen.getAllByText(/^[0-9]+$/);
    // Total, Active, Awaiting, Blocked, Done counts in order.
    expect(stats.map((n) => n.textContent)).toEqual(["5", "1", "1", "1", "1"]);
  });

  it("counts a run whose state is not in the category map as idle (not reflected in any stat but the total)", () => {
    mockUseRuns.mockReturnValue({
      runs: [makeRun({ id: "r1", state: "SomeUnknownState" })],
      loading: false,
      error: null,
      refetch: vi.fn(),
    });
    render(<DashboardPage />);

    const stats = screen.getAllByText(/^[0-9]+$/);
    // Total is 1, but none of Active/Awaiting/Blocked/Done count it.
    expect(stats.map((n) => n.textContent)).toEqual(["1", "0", "0", "0", "0"]);
  });

  it("passes all runs to RunsTable when the 'All' filter is active by default", () => {
    mockUseRuns.mockReturnValue({
      runs: [makeRun({ id: "r1" }), makeRun({ id: "r2", state: "Done" })],
      loading: false,
      error: null,
      refetch: vi.fn(),
    });
    render(<DashboardPage />);
    expect(screen.getByTestId("runs-table-ids").textContent).toBe("r1,r2");
  });

  it("filters the runs passed to RunsTable when a category filter is clicked", async () => {
    mockUseRuns.mockReturnValue({
      runs: [
        makeRun({ id: "r1", state: "Implementing" }),
        makeRun({ id: "r2", state: "Done" }),
      ],
      loading: false,
      error: null,
      refetch: vi.fn(),
    });
    render(<DashboardPage />);

    await userEvent.click(screen.getByRole("button", { name: "Done" }));
    expect(screen.getByTestId("runs-table-ids").textContent).toBe("r2");

    await userEvent.click(screen.getByRole("button", { name: "All" }));
    expect(screen.getByTestId("runs-table-ids").textContent).toBe("r1,r2");
  });

  it("opens the Linear sync dialog when 'Sync from Linear' is clicked, and closes it", async () => {
    mockUseRuns.mockReturnValue({ runs: [], loading: false, error: null, refetch: vi.fn() });
    render(<DashboardPage />);

    expect(screen.queryByTestId("sync-dialog")).toBeNull();
    await userEvent.click(screen.getByRole("button", { name: /Sync from Linear/i }));
    expect(screen.getByTestId("sync-dialog")).toBeDefined();

    await userEvent.click(screen.getByText("close-dialog"));
    expect(screen.queryByTestId("sync-dialog")).toBeNull();
  });

  it("calls refetch when the sync dialog reports ingested runs", async () => {
    const refetch = vi.fn();
    mockUseRuns.mockReturnValue({ runs: [], loading: false, error: null, refetch });
    render(<DashboardPage />);

    await userEvent.click(screen.getByRole("button", { name: /Sync from Linear/i }));
    await userEvent.click(screen.getByText("trigger-ingested"));
    expect(refetch).toHaveBeenCalledOnce();
  });

  it("calls refetch when a RunsTable row action completes", async () => {
    const refetch = vi.fn();
    mockUseRuns.mockReturnValue({
      runs: [makeRun()],
      loading: false,
      error: null,
      refetch,
    });
    render(<DashboardPage />);

    await userEvent.click(screen.getByText("trigger-table-action"));
    expect(refetch).toHaveBeenCalledOnce();
  });

  it("shows the ingest summary banner after a completed ingest and auto-dismisses it", () => {
    vi.useFakeTimers();
    mockUseRuns.mockReturnValue({ runs: [], loading: false, error: null, refetch: vi.fn() });
    render(<DashboardPage />);

    fireEvent.click(screen.getByRole("button", { name: /Sync from Linear/i }));
    fireEvent.click(screen.getByText("trigger-ingest-complete"));

    expect(screen.getByTestId("ingest-banner").textContent).toContain("Started 2, skipped 1");

    act(() => {
      vi.advanceTimersByTime(5000);
    });
    expect(screen.queryByTestId("ingest-banner")).toBeNull();
  });

  it("dismisses the ingest summary banner immediately when onDismiss is invoked", async () => {
    mockUseRuns.mockReturnValue({ runs: [], loading: false, error: null, refetch: vi.fn() });
    render(<DashboardPage />);

    await userEvent.click(screen.getByRole("button", { name: /Sync from Linear/i }));
    await userEvent.click(screen.getByText("trigger-ingest-complete"));
    expect(screen.getByTestId("ingest-banner")).toBeDefined();

    await userEvent.click(screen.getByText("dismiss-banner"));
    expect(screen.queryByTestId("ingest-banner")).toBeNull();
  });
});
