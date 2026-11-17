import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, act, within } from "@testing-library/react";
import type { Run } from "@/api/client.ts";

const useRunsMock = vi.fn();
vi.mock("@/hooks/useRuns.ts", () => ({
  useRuns: () => useRunsMock(),
}));

vi.mock("@/components/RunsTable.tsx", () => ({
  RunsTable: ({ runs }: { runs: Run[] }) => (
    <div data-testid="runs-table">{runs.map((r) => r.id).join(",")}</div>
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
      {open ? "open" : "closed"}
      <button onClick={() => onIngestComplete({ started: 2, skipped: 1 })}>
        simulate-ingest
      </button>
    </div>
  ),
}));

vi.mock("@/components/IngestSummaryBanner.tsx", () => ({
  IngestSummaryBanner: ({ started, skipped }: { started: number; skipped: number }) => (
    <div data-testid="ingest-banner">
      started={started} skipped={skipped}
    </div>
  ),
}));

import { DashboardPage } from "./DashboardPage.tsx";

function makeRun(overrides: Partial<Run> = {}): Run {
  return {
    id: "r1",
    linearIssueId: "LIN-1",
    linearIssueIdentifier: null,
    linearIssueDescription: null,
    linearIssueTitle: null,
    linearIssueUrl: null,
    repo: "test-repo",
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
    latestArtifactVersion: 1,
    createdAt: "2024-01-01T00:00:00Z",
    updatedAt: "2024-01-01T00:00:00Z",
    ...overrides,
  };
}

describe("DashboardPage", () => {
  beforeEach(() => {
    useRunsMock.mockReset();
  });

  it("shows a loading indicator while runs are loading", () => {
    useRunsMock.mockReturnValue({ runs: [], loading: true, error: null, refetch: vi.fn() });
    render(<DashboardPage />);
    expect(screen.getByText(/Loading runs/i)).toBeDefined();
  });

  it("shows the error banner when the hook reports an error", () => {
    useRunsMock.mockReturnValue({
      runs: [],
      loading: false,
      error: "Failed to fetch runs",
      refetch: vi.fn(),
    });
    render(<DashboardPage />);
    expect(screen.getByText("Failed to fetch runs")).toBeDefined();
  });

  it("renders the runs table and correct stat counts once loaded", () => {
    const runs = [
      makeRun({ id: "r1", state: "Planning" }), // active
      makeRun({ id: "r2", state: "AwaitingPlanApproval" }), // waiting
      makeRun({ id: "r3", state: "Done" }), // done
      makeRun({ id: "r4", state: "AIBlocked" }), // blocked
    ];
    useRunsMock.mockReturnValue({ runs, loading: false, error: null, refetch: vi.fn() });
    render(<DashboardPage />);

    expect(screen.getByTestId("runs-table").textContent).toBe("r1,r2,r3,r4");
    expect(screen.getByText("4")).toBeDefined(); // total
  });

  it("filters the runs table when a filter tab is clicked", () => {
    const runs = [
      makeRun({ id: "r1", state: "Planning" }),
      makeRun({ id: "r2", state: "Done" }),
    ];
    useRunsMock.mockReturnValue({ runs, loading: false, error: null, refetch: vi.fn() });
    render(<DashboardPage />);

    fireEvent.click(screen.getByRole("button", { name: "Done" }));
    expect(screen.getByTestId("runs-table").textContent).toBe("r2");

    fireEvent.click(screen.getByRole("button", { name: "All" }));
    expect(screen.getByTestId("runs-table").textContent).toBe("r1,r2");
  });

  it("opens the Linear sync dialog when 'Sync from Linear' is clicked", () => {
    useRunsMock.mockReturnValue({ runs: [], loading: false, error: null, refetch: vi.fn() });
    render(<DashboardPage />);

    expect(within(screen.getByTestId("sync-dialog")).getByText("closed")).toBeDefined();
    fireEvent.click(screen.getByText("Sync from Linear"));
    expect(within(screen.getByTestId("sync-dialog")).getByText("open")).toBeDefined();
  });

  it("shows the ingest summary banner after an ingest completes, then auto-dismisses it", () => {
    vi.useFakeTimers();
    useRunsMock.mockReturnValue({ runs: [], loading: false, error: null, refetch: vi.fn() });
    render(<DashboardPage />);

    fireEvent.click(screen.getByText("simulate-ingest"));
    expect(screen.getByTestId("ingest-banner").textContent).toContain("started=2");
    expect(screen.getByTestId("ingest-banner").textContent).toContain("skipped=1");

    act(() => {
      vi.advanceTimersByTime(5000);
    });
    expect(screen.queryByTestId("ingest-banner")).toBeNull();
    vi.useRealTimers();
  });
});
