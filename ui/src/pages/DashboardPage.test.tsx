import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, act } from "@testing-library/react";
import type { Run } from "@/api/client.ts";

const useRunsMock = vi.fn();

vi.mock("@/hooks/useRuns.ts", () => ({
  useRuns: () => useRunsMock(),
}));

vi.mock("@/components/RunsTable.tsx", () => ({
  RunsTable: (props: { runs: Run[]; onAction: () => void }) => (
    <div data-testid="runs-table">{props.runs.length} runs</div>
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
      <div data-testid="sync-dialog">
        <button onClick={() => props.onIngestComplete({ started: 2, skipped: 1 })}>
          finish-ingest
        </button>
        <button onClick={props.onClose}>close</button>
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
      {props.started} started, {props.skipped} skipped
      <button onClick={props.onDismiss}>dismiss</button>
    </div>
  ),
}));

import { DashboardPage } from "./DashboardPage.tsx";

function makeRun(overrides: Partial<Run> = {}): Run {
  return {
    id: "run-1",
    linearIssueId: "LIN-1",
    linearIssueIdentifier: null,
    linearIssueDescription: null,
    linearIssueTitle: null,
    linearIssueUrl: null,
    repo: "test-repo",
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
    latestArtifactVersion: 1,
    createdAt: "2026-01-01T00:00:00Z",
    updatedAt: "2026-01-01T00:00:00Z",
    ...overrides,
  };
}

describe("DashboardPage", () => {
  beforeEach(() => {
    useRunsMock.mockReset();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("shows a loading indicator while runs are loading", () => {
    useRunsMock.mockReturnValue({
      runs: [],
      loading: true,
      error: null,
      refetch: vi.fn(),
    });
    render(<DashboardPage />);
    expect(screen.getByText("Loading runs...")).toBeDefined();
    expect(screen.queryByTestId("runs-table")).toBeNull();
  });

  it("shows an error message when the fetch failed", () => {
    useRunsMock.mockReturnValue({
      runs: [],
      loading: false,
      error: "network down",
      refetch: vi.fn(),
    });
    render(<DashboardPage />);
    expect(screen.getByText("network down")).toBeDefined();
    expect(screen.queryByTestId("runs-table")).toBeNull();
  });

  it("renders the runs table once loaded and computes stat counts", () => {
    useRunsMock.mockReturnValue({
      runs: [
        makeRun({ id: "r1", state: "Planning" }), // active
        makeRun({ id: "r2", state: "AwaitingPlanApproval" }), // waiting
        makeRun({ id: "r3", state: "Done" }), // done
      ],
      loading: false,
      error: null,
      refetch: vi.fn(),
    });
    render(<DashboardPage />);
    expect(screen.getByTestId("runs-table")).toBeDefined();
    expect(screen.getByText("3")).toBeDefined(); // Total
    // Each stat appears exactly once since one run lands in each category.
    expect(screen.getAllByText("1")).toHaveLength(3);
  });

  it("filters the runs table by category when a filter button is clicked", () => {
    useRunsMock.mockReturnValue({
      runs: [
        makeRun({ id: "r1", state: "Planning" }), // active
        makeRun({ id: "r2", state: "Done" }), // done
      ],
      loading: false,
      error: null,
      refetch: vi.fn(),
    });
    render(<DashboardPage />);
    expect(screen.getByText("2 runs")).toBeDefined();

    fireEvent.click(screen.getByRole("button", { name: "Active" }));
    expect(screen.getByText("1 runs")).toBeDefined();

    fireEvent.click(screen.getByRole("button", { name: "All" }));
    expect(screen.getByText("2 runs")).toBeDefined();
  });

  it("buckets a run whose state isn't in the category map under 'idle' (counted in Total, excluded from every category filter)", () => {
    useRunsMock.mockReturnValue({
      runs: [
        makeRun({ id: "r1", state: "Done" }), // done
        makeRun({ id: "r2", state: "SomeFutureState" }), // unmapped -> idle
      ],
      loading: false,
      error: null,
      refetch: vi.fn(),
    });
    render(<DashboardPage />);
    expect(screen.getByText("2")).toBeDefined(); // Total includes the unmapped run

    fireEvent.click(screen.getByRole("button", { name: "Done" }));
    expect(screen.getByText("1 runs")).toBeDefined(); // only the mapped "Done" run

    fireEvent.click(screen.getByRole("button", { name: "All" }));
    expect(screen.getByText("2 runs")).toBeDefined(); // unmapped run still shows under "All"
  });

  it("opens the Linear sync dialog and shows the ingest summary banner, auto-dismissing it", () => {
    vi.useFakeTimers();
    useRunsMock.mockReturnValue({
      runs: [],
      loading: false,
      error: null,
      refetch: vi.fn(),
    });
    render(<DashboardPage />);

    expect(screen.queryByTestId("sync-dialog")).toBeNull();
    fireEvent.click(screen.getByText("Sync from Linear"));
    expect(screen.getByTestId("sync-dialog")).toBeDefined();

    fireEvent.click(screen.getByText("finish-ingest"));
    expect(screen.getByText("2 started, 1 skipped")).toBeDefined();

    act(() => {
      vi.advanceTimersByTime(5000);
    });
    expect(screen.queryByTestId("ingest-banner")).toBeNull();
  });

  it("dismisses the ingest summary banner manually before the timer fires", () => {
    vi.useFakeTimers();
    useRunsMock.mockReturnValue({
      runs: [],
      loading: false,
      error: null,
      refetch: vi.fn(),
    });
    render(<DashboardPage />);

    fireEvent.click(screen.getByText("Sync from Linear"));
    fireEvent.click(screen.getByText("finish-ingest"));
    expect(screen.getByTestId("ingest-banner")).toBeDefined();

    fireEvent.click(screen.getByText("dismiss"));
    expect(screen.queryByTestId("ingest-banner")).toBeNull();
  });

  it("closes the Linear sync dialog via onClose", () => {
    useRunsMock.mockReturnValue({
      runs: [],
      loading: false,
      error: null,
      refetch: vi.fn(),
    });
    render(<DashboardPage />);

    fireEvent.click(screen.getByText("Sync from Linear"));
    expect(screen.getByTestId("sync-dialog")).toBeDefined();
    fireEvent.click(screen.getByText("close"));
    expect(screen.queryByTestId("sync-dialog")).toBeNull();
  });
});
