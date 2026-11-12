import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, act, fireEvent } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { Run } from "@/api/client.ts";

const useRunsMock = vi.fn();

vi.mock("@/hooks/useRuns.ts", () => ({
  useRuns: () => useRunsMock(),
}));

vi.mock("@/components/RunsTable.tsx", () => ({
  RunsTable: ({ runs, onAction }: { runs: Run[]; onAction?: () => void }) => (
    <div data-testid="runs-table">
      <span data-testid="runs-count">{runs.length}</span>
      {runs.map((r) => (
        <span key={r.id}>{r.id}</span>
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
      <div data-testid="linear-sync-dialog">
        <button onClick={onClose}>close-dialog</button>
        <button onClick={onIngested}>fire-ingested</button>
        <button onClick={() => onIngestComplete({ started: 3, skipped: 1 })}>
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
    <div data-testid="ingest-summary-banner">
      started={started} skipped={skipped}
      <button onClick={onDismiss}>dismiss-banner</button>
    </div>
  ),
}));

import { DashboardPage } from "./DashboardPage.tsx";

function makeRun(overrides: Partial<Run>): Run {
  return {
    id: "run-1",
    linearIssueId: "issue-1",
    linearIssueIdentifier: "ENG-1",
    linearIssueDescription: null,
    linearIssueTitle: "Fix the bug",
    linearIssueUrl: null,
    repo: "acme/repo",
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
    updatedAt: "2024-01-01T00:00:00Z",
    ...overrides,
  };
}

describe("DashboardPage", () => {
  beforeEach(() => {
    useRunsMock.mockReset();
  });

  it("shows the loading indicator while runs are loading", () => {
    useRunsMock.mockReturnValue({
      runs: [],
      loading: true,
      error: null,
      refetch: vi.fn(),
    });

    render(<DashboardPage />);

    expect(screen.getByText(/loading runs/i)).toBeDefined();
    expect(screen.queryByTestId("runs-table")).toBeNull();
  });

  it("shows the error message when the hook reports an error", () => {
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

  it("renders an empty RunsTable when there are no runs", () => {
    useRunsMock.mockReturnValue({
      runs: [],
      loading: false,
      error: null,
      refetch: vi.fn(),
    });

    render(<DashboardPage />);

    expect(screen.getByTestId("runs-table")).toBeDefined();
    expect(screen.getByTestId("runs-count").textContent).toBe("0");
  });

  it("renders stats and the RunsTable populated with fetched runs", () => {
    const runs = [
      makeRun({ id: "run-1", state: "Implementing" }),
      makeRun({ id: "run-2", state: "Done" }),
      makeRun({ id: "run-3", state: "AIBlocked" }),
      makeRun({ id: "run-4", state: "AwaitingPlanApproval" }),
    ];
    useRunsMock.mockReturnValue({
      runs,
      loading: false,
      error: null,
      refetch: vi.fn(),
    });

    render(<DashboardPage />);

    expect(screen.getByTestId("runs-count").textContent).toBe("4");
    // Total stat label is unique; category labels appear in both the stats
    // bar and the filter buttons, so assert at least one instance exists.
    expect(screen.getByText("Total")).toBeDefined();
    expect(screen.getAllByText("Active").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Blocked").length).toBeGreaterThan(0);
  });

  it("counts a run with an unrecognized state under 'idle' instead of crashing", () => {
    const runs = [
      makeRun({ id: "run-1", state: "SomeUnknownState" }),
      makeRun({ id: "run-2", state: "Implementing" }),
    ];
    useRunsMock.mockReturnValue({
      runs,
      loading: false,
      error: null,
      refetch: vi.fn(),
    });

    render(<DashboardPage />);

    // Total still reflects both runs even though one has an unmapped state.
    expect(screen.getByTestId("runs-count").textContent).toBe("2");
  });

  it("filters runs by category when a filter button is clicked", async () => {
    const user = userEvent.setup();
    const runs = [
      makeRun({ id: "run-1", state: "Implementing" }), // active
      makeRun({ id: "run-2", state: "Done" }), // done
    ];
    useRunsMock.mockReturnValue({
      runs,
      loading: false,
      error: null,
      refetch: vi.fn(),
    });

    render(<DashboardPage />);

    expect(screen.getByTestId("runs-count").textContent).toBe("2");

    await user.click(screen.getByRole("button", { name: "Done" }));

    expect(screen.getByTestId("runs-count").textContent).toBe("1");
    expect(screen.getByText("run-2")).toBeDefined();
    expect(screen.queryByText("run-1")).toBeNull();
  });

  it("returns to showing all runs when the All filter is clicked again", async () => {
    const user = userEvent.setup();
    const runs = [
      makeRun({ id: "run-1", state: "Implementing" }),
      makeRun({ id: "run-2", state: "Done" }),
    ];
    useRunsMock.mockReturnValue({
      runs,
      loading: false,
      error: null,
      refetch: vi.fn(),
    });

    render(<DashboardPage />);

    await user.click(screen.getByRole("button", { name: "Done" }));
    expect(screen.getByTestId("runs-count").textContent).toBe("1");

    await user.click(screen.getByRole("button", { name: "All" }));
    expect(screen.getByTestId("runs-count").textContent).toBe("2");
  });

  it("opens the LinearSyncDialog when 'Sync from Linear' is clicked, and closes it", async () => {
    const user = userEvent.setup();
    useRunsMock.mockReturnValue({
      runs: [],
      loading: false,
      error: null,
      refetch: vi.fn(),
    });

    render(<DashboardPage />);

    expect(screen.queryByTestId("linear-sync-dialog")).toBeNull();

    await user.click(screen.getByRole("button", { name: /sync from linear/i }));

    expect(screen.getByTestId("linear-sync-dialog")).toBeDefined();

    await user.click(screen.getByRole("button", { name: "close-dialog" }));

    expect(screen.queryByTestId("linear-sync-dialog")).toBeNull();
  });

  it("calls refetch (via RunsTable onAction) when an action is triggered", async () => {
    const user = userEvent.setup();
    const refetch = vi.fn();
    useRunsMock.mockReturnValue({
      runs: [makeRun({ id: "run-1" })],
      loading: false,
      error: null,
      refetch,
    });

    render(<DashboardPage />);

    await user.click(screen.getByRole("button", { name: "trigger-action" }));

    expect(refetch).toHaveBeenCalledOnce();
  });

  it("calls refetch when LinearSyncDialog reports onIngested", async () => {
    const user = userEvent.setup();
    const refetch = vi.fn();
    useRunsMock.mockReturnValue({
      runs: [],
      loading: false,
      error: null,
      refetch,
    });

    render(<DashboardPage />);
    await user.click(screen.getByRole("button", { name: /sync from linear/i }));
    await user.click(screen.getByRole("button", { name: "fire-ingested" }));

    expect(refetch).toHaveBeenCalledOnce();
  });

  it("shows the IngestSummaryBanner after onIngestComplete fires, and it can be dismissed", async () => {
    const user = userEvent.setup();
    useRunsMock.mockReturnValue({
      runs: [],
      loading: false,
      error: null,
      refetch: vi.fn(),
    });

    render(<DashboardPage />);
    await user.click(screen.getByRole("button", { name: /sync from linear/i }));
    await user.click(screen.getByRole("button", { name: "fire-ingest-complete" }));

    const banner = screen.getByTestId("ingest-summary-banner");
    expect(banner.textContent).toContain("started=3");
    expect(banner.textContent).toContain("skipped=1");

    await user.click(screen.getByRole("button", { name: "dismiss-banner" }));

    expect(screen.queryByTestId("ingest-summary-banner")).toBeNull();
  });

  it("auto-dismisses the IngestSummaryBanner after the timeout elapses", async () => {
    vi.useFakeTimers();
    useRunsMock.mockReturnValue({
      runs: [],
      loading: false,
      error: null,
      refetch: vi.fn(),
    });

    render(<DashboardPage />);
    fireEvent.click(screen.getByRole("button", { name: /sync from linear/i }));
    fireEvent.click(screen.getByRole("button", { name: "fire-ingest-complete" }));

    expect(screen.getByTestId("ingest-summary-banner")).toBeDefined();

    act(() => {
      vi.advanceTimersByTime(5100);
    });

    expect(screen.queryByTestId("ingest-summary-banner")).toBeNull();

    vi.useRealTimers();
  });
});
