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
    <div data-testid="runs-table">{runs.map((r) => r.id).join(",")}</div>
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
    <div data-testid="ingest-banner">
      started={started} skipped={skipped}
      <button onClick={onDismiss}>dismiss</button>
    </div>
  ),
}));

let capturedSyncProps: {
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
    capturedSyncProps = props;
    return props.open ? <div data-testid="sync-dialog" /> : null;
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
    latestArtifactVersion: 0,
    createdAt: "2024-01-01T00:00:00Z",
    updatedAt: "2024-01-01T00:00:00Z",
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
    expect(screen.getByText("Loading runs...")).toBeDefined();
    expect(screen.queryByTestId("runs-table")).toBeNull();
  });

  it("shows an error banner instead of the table when the fetch fails", () => {
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

  it("computes per-category stats from the run states", () => {
    useRunsMock.mockReturnValue({
      runs: [
        makeRun("r1", "Implementing"),
        makeRun("r2", "AwaitingPlanApproval"),
        makeRun("r3", "AIBlocked"),
        makeRun("r4", "Done"),
        makeRun("r5", "Todo"),
      ],
      loading: false,
      error: null,
      refetch: vi.fn(),
    });
    render(<DashboardPage />);

    expect(screen.getByText("5")).toBeDefined(); // total
    // Each stat value of 1 appears four times (active/awaiting/blocked/done)
    const ones = screen.getAllByText("1");
    expect(ones.length).toBe(4);
  });

  it("buckets a run with an unrecognized state under 'idle' for the stats", () => {
    useRunsMock.mockReturnValue({
      runs: [makeRun("r1", "SomeUnknownState")],
      loading: false,
      error: null,
      refetch: vi.fn(),
    });
    render(<DashboardPage />);

    // Total is 1, and none of active/waiting/blocked/done buckets get it.
    const totals = screen.getAllByText("1");
    expect(totals.length).toBe(1);
  });

  it("filters the runs passed to RunsTable by category", async () => {
    useRunsMock.mockReturnValue({
      runs: [
        makeRun("r1", "Implementing"),
        makeRun("r2", "Done"),
      ],
      loading: false,
      error: null,
      refetch: vi.fn(),
    });
    render(<DashboardPage />);

    expect(screen.getByTestId("runs-table").textContent).toBe("r1,r2");

    await userEvent.click(screen.getByRole("button", { name: "Active" }));
    expect(screen.getByTestId("runs-table").textContent).toBe("r1");

    await userEvent.click(screen.getByRole("button", { name: "Done" }));
    expect(screen.getByTestId("runs-table").textContent).toBe("r2");

    await userEvent.click(screen.getByRole("button", { name: "All" }));
    expect(screen.getByTestId("runs-table").textContent).toBe("r1,r2");
  });

  it("opens the Linear sync dialog when 'Sync from Linear' is clicked", async () => {
    useRunsMock.mockReturnValue({ runs: [], loading: false, error: null, refetch: vi.fn() });
    render(<DashboardPage />);

    expect(screen.queryByTestId("sync-dialog")).toBeNull();
    await userEvent.click(screen.getByRole("button", { name: /Sync from Linear/ }));
    expect(screen.getByTestId("sync-dialog")).toBeDefined();
  });

  it("shows the ingest summary banner after onIngestComplete fires, and auto-dismisses it", async () => {
    vi.useFakeTimers();
    useRunsMock.mockReturnValue({ runs: [], loading: false, error: null, refetch: vi.fn() });
    render(<DashboardPage />);

    expect(capturedSyncProps).not.toBeNull();
    act(() => {
      capturedSyncProps!.onIngestComplete?.({ started: 3, skipped: 1 });
    });

    expect(screen.getByTestId("ingest-banner").textContent).toContain("started=3");
    expect(screen.getByTestId("ingest-banner").textContent).toContain("skipped=1");

    act(() => {
      vi.advanceTimersByTime(5000);
    });
    expect(screen.queryByTestId("ingest-banner")).toBeNull();
  });

  it("dismisses the ingest summary banner manually via its dismiss button", async () => {
    useRunsMock.mockReturnValue({ runs: [], loading: false, error: null, refetch: vi.fn() });
    render(<DashboardPage />);

    act(() => {
      capturedSyncProps!.onIngestComplete?.({ started: 1, skipped: 0 });
    });
    expect(screen.getByTestId("ingest-banner")).toBeDefined();

    await userEvent.click(screen.getByText("dismiss"));
    expect(screen.queryByTestId("ingest-banner")).toBeNull();
  });

  it("closes the sync dialog when it reports onClose", async () => {
    useRunsMock.mockReturnValue({ runs: [], loading: false, error: null, refetch: vi.fn() });
    render(<DashboardPage />);

    await userEvent.click(screen.getByRole("button", { name: /Sync from Linear/ }));
    expect(screen.getByTestId("sync-dialog")).toBeDefined();

    act(() => {
      capturedSyncProps!.onClose();
    });
    expect(screen.queryByTestId("sync-dialog")).toBeNull();
  });

  it("calls refetch when the sync dialog reports runs were ingested", () => {
    const refetch = vi.fn();
    useRunsMock.mockReturnValue({ runs: [], loading: false, error: null, refetch });
    render(<DashboardPage />);

    act(() => {
      capturedSyncProps!.onIngested();
    });
    expect(refetch).toHaveBeenCalledTimes(1);
  });
});
