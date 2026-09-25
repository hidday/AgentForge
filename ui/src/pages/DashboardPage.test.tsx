import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { Run } from "@/api/client.ts";

const useRunsMock = vi.fn();
vi.mock("@/hooks/useRuns.ts", () => ({
  useRuns: () => useRunsMock(),
}));

const runsTableMock = vi.fn();
vi.mock("@/components/RunsTable.tsx", () => ({
  RunsTable: (props: unknown) => {
    runsTableMock(props);
    return <div data-testid="runs-table-marker" />;
  },
}));

const linearSyncDialogMock = vi.fn();
vi.mock("@/components/LinearSyncDialog.tsx", () => ({
  LinearSyncDialog: (props: unknown) => {
    linearSyncDialogMock(props);
    return <div data-testid="linear-sync-dialog-marker" />;
  },
}));

const ingestSummaryBannerMock = vi.fn();
vi.mock("@/components/IngestSummaryBanner.tsx", () => ({
  IngestSummaryBanner: (props: unknown) => {
    ingestSummaryBannerMock(props);
    return <div data-testid="ingest-summary-banner-marker" />;
  },
}));

import { DashboardPage } from "./DashboardPage.tsx";

function makeRun(overrides: Partial<Run>): Run {
  return {
    id: "run-1",
    linearIssueId: "issue-1",
    linearIssueIdentifier: "ENG-1",
    linearIssueDescription: null,
    linearIssueTitle: "Some issue",
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
    workingDirectory: "/tmp/wd",
    latestArtifactVersion: 1,
    createdAt: "2024-01-01T00:00:00Z",
    updatedAt: "2024-01-01T00:00:00Z",
    ...overrides,
  } as Run;
}

describe("DashboardPage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("shows the loading indicator and does not render RunsTable while loading", () => {
    useRunsMock.mockReturnValue({ runs: [], loading: true, error: null, refetch: vi.fn() });
    render(<DashboardPage />);
    expect(screen.getByText(/loading runs/i)).toBeDefined();
    expect(screen.queryByTestId("runs-table-marker")).toBeNull();
  });

  it("shows the error message and does not render RunsTable on error", () => {
    useRunsMock.mockReturnValue({
      runs: [],
      loading: false,
      error: "Failed to fetch runs",
      refetch: vi.fn(),
    });
    render(<DashboardPage />);
    expect(screen.getByText("Failed to fetch runs")).toBeDefined();
    expect(screen.queryByTestId("runs-table-marker")).toBeNull();
  });

  it("renders RunsTable with an empty runs array in the empty state", () => {
    useRunsMock.mockReturnValue({ runs: [], loading: false, error: null, refetch: vi.fn() });
    render(<DashboardPage />);
    expect(screen.getByTestId("runs-table-marker")).toBeDefined();
    expect(runsTableMock).toHaveBeenCalledWith(
      expect.objectContaining({ runs: [] }),
    );
  });

  it("passes all runs to RunsTable and wires onAction to refetch by default (filter=all)", () => {
    const refetch = vi.fn();
    const runs = [
      makeRun({ id: "r1", state: "Todo" }),
      makeRun({ id: "r2", state: "Implementing" }),
      makeRun({ id: "r3", state: "AIBlocked" }),
    ];
    useRunsMock.mockReturnValue({ runs, loading: false, error: null, refetch });
    render(<DashboardPage />);

    expect(runsTableMock).toHaveBeenCalledWith(
      expect.objectContaining({ runs, onAction: refetch }),
    );
  });

  it("computes and displays correct stat counts per category", () => {
    const runs = [
      makeRun({ id: "r1", state: "Todo" }), // idle
      makeRun({ id: "r2", state: "Implementing" }), // active
      makeRun({ id: "r3", state: "Planning" }), // active
      makeRun({ id: "r4", state: "AIBlocked" }), // blocked
      makeRun({ id: "r5", state: "Done" }), // done
      makeRun({ id: "r6", state: "AwaitingPlanApproval" }), // waiting
    ];
    useRunsMock.mockReturnValue({ runs, loading: false, error: null, refetch: vi.fn() });
    render(<DashboardPage />);

    // Total
    expect(screen.getByText("6")).toBeDefined();
    // Active count = 2, Blocked = 1, Done = 1, Waiting = 1 — each should appear
    const twos = screen.getAllByText("2");
    expect(twos.length).toBeGreaterThanOrEqual(1);
    const ones = screen.getAllByText("1");
    expect(ones.length).toBeGreaterThanOrEqual(3);
  });

  it("filters runs passed to RunsTable when a filter button is clicked", async () => {
    const runs = [
      makeRun({ id: "r1", state: "Todo" }), // idle
      makeRun({ id: "r2", state: "AIBlocked" }), // blocked
    ];
    useRunsMock.mockReturnValue({ runs, loading: false, error: null, refetch: vi.fn() });
    render(<DashboardPage />);

    runsTableMock.mockClear();
    await userEvent.click(screen.getByRole("button", { name: "Blocked" }));

    expect(runsTableMock).toHaveBeenCalledWith(
      expect.objectContaining({ runs: [runs[1]] }),
    );
  });

  it("opens the LinearSyncDialog when 'Sync from Linear' is clicked", async () => {
    useRunsMock.mockReturnValue({ runs: [], loading: false, error: null, refetch: vi.fn() });
    render(<DashboardPage />);

    expect(linearSyncDialogMock).toHaveBeenLastCalledWith(
      expect.objectContaining({ open: false }),
    );

    await userEvent.click(screen.getByRole("button", { name: /sync from linear/i }));

    expect(linearSyncDialogMock).toHaveBeenLastCalledWith(
      expect.objectContaining({ open: true }),
    );
  });

  it("does not render the ingest summary banner until onIngestComplete fires", () => {
    useRunsMock.mockReturnValue({ runs: [], loading: false, error: null, refetch: vi.fn() });
    render(<DashboardPage />);
    expect(screen.queryByTestId("ingest-summary-banner-marker")).toBeNull();
  });

  it("renders IngestSummaryBanner with started/skipped counts after onIngestComplete fires", async () => {
    useRunsMock.mockReturnValue({ runs: [], loading: false, error: null, refetch: vi.fn() });
    render(<DashboardPage />);

    const { onIngestComplete } = linearSyncDialogMock.mock.calls[0]![0] as {
      onIngestComplete: (s: { started: number; skipped: number }) => void;
    };

    onIngestComplete({ started: 3, skipped: 1 });

    expect(await screen.findByTestId("ingest-summary-banner-marker")).toBeDefined();
    expect(ingestSummaryBannerMock).toHaveBeenLastCalledWith(
      expect.objectContaining({ started: 3, skipped: 1 }),
    );
  });

  it("dismisses the ingest summary banner when onDismiss is invoked", async () => {
    useRunsMock.mockReturnValue({ runs: [], loading: false, error: null, refetch: vi.fn() });
    render(<DashboardPage />);

    const { onIngestComplete } = linearSyncDialogMock.mock.calls[0]![0] as {
      onIngestComplete: (s: { started: number; skipped: number }) => void;
    };
    onIngestComplete({ started: 2, skipped: 0 });
    await screen.findByTestId("ingest-summary-banner-marker");

    const { onDismiss } = ingestSummaryBannerMock.mock.calls[0]![0] as {
      onDismiss: () => void;
    };
    onDismiss();

    expect(screen.queryByTestId("ingest-summary-banner-marker")).toBeNull();
  });

  it("auto-dismisses the ingest summary banner after the timeout elapses", async () => {
    vi.useFakeTimers();
    useRunsMock.mockReturnValue({ runs: [], loading: false, error: null, refetch: vi.fn() });
    render(<DashboardPage />);

    const { onIngestComplete } = linearSyncDialogMock.mock.calls[0]![0] as {
      onIngestComplete: (s: { started: number; skipped: number }) => void;
    };
    onIngestComplete({ started: 1, skipped: 0 });
    expect(screen.getByTestId("ingest-summary-banner-marker")).toBeDefined();

    vi.advanceTimersByTime(5000);

    expect(screen.queryByTestId("ingest-summary-banner-marker")).toBeNull();
  });

  it("wires onIngested and onClose on the LinearSyncDialog", async () => {
    const refetch = vi.fn();
    useRunsMock.mockReturnValue({ runs: [], loading: false, error: null, refetch });
    render(<DashboardPage />);

    const props = linearSyncDialogMock.mock.calls[0]![0] as {
      onIngested: () => void;
      onClose: () => void;
    };
    props.onIngested();
    expect(refetch).toHaveBeenCalledTimes(1);

    await userEvent.click(screen.getByRole("button", { name: /sync from linear/i }));
    expect(linearSyncDialogMock).toHaveBeenLastCalledWith(
      expect.objectContaining({ open: true }),
    );
    const latestProps = linearSyncDialogMock.mock.calls[
      linearSyncDialogMock.mock.calls.length - 1
    ]![0] as { onClose: () => void };
    latestProps.onClose();
    expect(linearSyncDialogMock).toHaveBeenLastCalledWith(
      expect.objectContaining({ open: false }),
    );
  });
});
