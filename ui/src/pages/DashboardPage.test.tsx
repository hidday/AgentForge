import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, act } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { Run } from "@/api/client.ts";

const useRunsMock = vi.fn();
vi.mock("@/hooks/useRuns.ts", () => ({
  useRuns: () => useRunsMock(),
}));

vi.mock("@/components/RunsTable.tsx", () => ({
  RunsTable: ({ runs }: { runs: Run[] }) => (
    <div data-testid="runs-table">{runs.length} runs</div>
  ),
}));

let capturedSyncProps: {
  open: boolean;
  onClose: () => void;
  onIngested: () => void;
  onIngestComplete: (s: { started: number; skipped: number }) => void;
} | null = null;

vi.mock("@/components/LinearSyncDialog.tsx", () => ({
  LinearSyncDialog: (props: {
    open: boolean;
    onClose: () => void;
    onIngested: () => void;
    onIngestComplete: (s: { started: number; skipped: number }) => void;
  }) => {
    capturedSyncProps = props;
    return props.open ? <div data-testid="sync-dialog" /> : null;
  },
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
      <button onClick={onDismiss}>dismiss</button>
    </div>
  ),
}));

import { DashboardPage } from "./DashboardPage.tsx";

function makeRun(overrides: Partial<Run> = {}): Run {
  return {
    id: "run-1",
    linearIssueId: "issue-1",
    linearIssueIdentifier: "ENG-1",
    linearIssueDescription: null,
    linearIssueTitle: "Issue",
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
    latestArtifactVersion: 1,
    createdAt: "2024-01-01T00:00:00Z",
    updatedAt: "2024-01-01T00:00:00Z",
    ...overrides,
  };
}

describe("DashboardPage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    capturedSyncProps = null;
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("shows a loading indicator while runs are loading", () => {
    useRunsMock.mockReturnValue({ runs: [], loading: true, error: null, refetch: vi.fn() });
    render(<DashboardPage />);
    expect(screen.getByText(/Loading runs/i)).toBeDefined();
    expect(screen.queryByTestId("runs-table")).toBeNull();
  });

  it("shows an error message when the hook reports an error", () => {
    useRunsMock.mockReturnValue({
      runs: [],
      loading: false,
      error: "Failed to fetch runs",
      refetch: vi.fn(),
    });
    render(<DashboardPage />);
    expect(screen.getByText("Failed to fetch runs")).toBeDefined();
    expect(screen.queryByTestId("runs-table")).toBeNull();
  });

  it("renders the RunsTable with all runs when filter is 'all'", () => {
    useRunsMock.mockReturnValue({
      runs: [makeRun({ id: "a" }), makeRun({ id: "b", state: "Done" })],
      loading: false,
      error: null,
      refetch: vi.fn(),
    });
    render(<DashboardPage />);
    expect(screen.getByTestId("runs-table").textContent).toBe("2 runs");
  });

  it("buckets a run with an unrecognized state under 'idle' for the counts", () => {
    useRunsMock.mockReturnValue({
      runs: [makeRun({ id: "a", state: "SomeUnmappedState" })],
      loading: false,
      error: null,
      refetch: vi.fn(),
    });
    render(<DashboardPage />);
    expect(screen.getByText("Total").previousSibling?.textContent).toBe("1");
    expect(screen.getAllByText("Active")[0].previousSibling?.textContent).toBe("0");
  });

  it("computes per-category counts in the stats bar", () => {
    useRunsMock.mockReturnValue({
      runs: [
        makeRun({ id: "a", state: "Implementing" }),
        makeRun({ id: "b", state: "Done" }),
        makeRun({ id: "c", state: "AIBlocked" }),
      ],
      loading: false,
      error: null,
      refetch: vi.fn(),
    });
    render(<DashboardPage />);
    expect(screen.getByText("Total").previousSibling?.textContent).toBe("3");
    expect(screen.getAllByText("Active")[0].previousSibling?.textContent).toBe("1");
    expect(screen.getAllByText("Blocked")[0].previousSibling?.textContent).toBe("1");
    expect(screen.getAllByText("Done")[0].previousSibling?.textContent).toBe("1");
  });

  it("filters runs by category when a filter button is clicked", async () => {
    useRunsMock.mockReturnValue({
      runs: [
        makeRun({ id: "a", state: "Done" }),
        makeRun({ id: "b", state: "Implementing" }),
      ],
      loading: false,
      error: null,
      refetch: vi.fn(),
    });
    render(<DashboardPage />);
    expect(screen.getByTestId("runs-table").textContent).toBe("2 runs");

    await userEvent.click(screen.getByRole("button", { name: "Done" }));
    expect(screen.getByTestId("runs-table").textContent).toBe("1 runs");

    await userEvent.click(screen.getByRole("button", { name: "All" }));
    expect(screen.getByTestId("runs-table").textContent).toBe("2 runs");
  });

  it("opens the LinearSyncDialog when 'Sync from Linear' is clicked", async () => {
    useRunsMock.mockReturnValue({ runs: [], loading: false, error: null, refetch: vi.fn() });
    render(<DashboardPage />);
    expect(screen.queryByTestId("sync-dialog")).toBeNull();

    await userEvent.click(screen.getByRole("button", { name: /Sync from Linear/i }));
    expect(screen.getByTestId("sync-dialog")).toBeDefined();
  });

  it("shows the ingest summary banner after onIngestComplete fires, and auto-dismisses it", () => {
    vi.useFakeTimers();
    useRunsMock.mockReturnValue({ runs: [], loading: false, error: null, refetch: vi.fn() });
    render(<DashboardPage />);

    act(() => {
      capturedSyncProps?.onIngestComplete({ started: 3, skipped: 1 });
    });

    expect(screen.getByTestId("ingest-banner").textContent).toBe("Started 3, skipped 1dismiss");

    act(() => {
      vi.advanceTimersByTime(5000);
    });

    expect(screen.queryByTestId("ingest-banner")).toBeNull();
  });

  it("dismisses the ingest summary banner immediately when its dismiss button is clicked", () => {
    useRunsMock.mockReturnValue({ runs: [], loading: false, error: null, refetch: vi.fn() });
    render(<DashboardPage />);

    act(() => {
      capturedSyncProps?.onIngestComplete({ started: 1, skipped: 0 });
    });
    expect(screen.getByTestId("ingest-banner")).toBeDefined();

    act(() => {
      screen.getByText("dismiss").click();
    });
    expect(screen.queryByTestId("ingest-banner")).toBeNull();
  });

  it("calls refetch via onIngested/onAction wiring without throwing", async () => {
    const refetch = vi.fn();
    useRunsMock.mockReturnValue({ runs: [], loading: false, error: null, refetch });
    render(<DashboardPage />);

    act(() => {
      capturedSyncProps?.onIngested();
    });
    expect(refetch).toHaveBeenCalled();
  });

  it("closes the LinearSyncDialog via onClose", async () => {
    useRunsMock.mockReturnValue({ runs: [], loading: false, error: null, refetch: vi.fn() });
    render(<DashboardPage />);

    await userEvent.click(screen.getByRole("button", { name: /Sync from Linear/i }));
    expect(screen.getByTestId("sync-dialog")).toBeDefined();

    act(() => {
      capturedSyncProps?.onClose();
    });
    expect(screen.queryByTestId("sync-dialog")).toBeNull();
  });
});
