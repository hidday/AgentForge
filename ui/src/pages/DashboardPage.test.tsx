import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, act } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { Run } from "@/api/client.ts";

vi.mock("@/hooks/useRuns.ts", () => ({
  useRuns: vi.fn(),
}));

vi.mock("@/components/RunsTable.tsx", () => ({
  RunsTable: vi.fn((props: { runs: Run[]; onAction?: () => void }) => (
    <div data-testid="runs-table" data-count={props.runs.length}>
      {props.runs.map((r) => (
        <span key={r.id}>{r.id}</span>
      ))}
      <button onClick={props.onAction}>trigger-action</button>
    </div>
  )),
}));

vi.mock("@/components/LinearSyncDialog.tsx", () => ({
  LinearSyncDialog: vi.fn(
    (props: {
      open: boolean;
      onClose: () => void;
      onIngested: () => void;
      onIngestComplete?: (s: { started: number; skipped: number }) => void;
    }) => (
      <div data-testid="linear-sync-dialog" data-open={String(props.open)}>
        <button onClick={props.onClose}>close-dialog</button>
        <button onClick={props.onIngested}>trigger-ingested</button>
        <button
          onClick={() => props.onIngestComplete?.({ started: 3, skipped: 1 })}
        >
          trigger-ingest-complete
        </button>
      </div>
    ),
  ),
}));

vi.mock("@/components/IngestSummaryBanner.tsx", () => ({
  IngestSummaryBanner: vi.fn(
    (props: { started: number; skipped: number; onDismiss: () => void }) => (
      <div data-testid="ingest-summary-banner">
        started:{props.started} skipped:{props.skipped}
        <button onClick={props.onDismiss}>dismiss-banner</button>
      </div>
    ),
  ),
}));

import { useRuns } from "@/hooks/useRuns.ts";
import { DashboardPage } from "./DashboardPage.tsx";

const mockUseRuns = useRuns as unknown as ReturnType<typeof vi.fn>;

function makeRun(overrides: Partial<Run>): Run {
  return {
    id: "run-1",
    linearIssueId: "issue-1",
    linearIssueIdentifier: "ENG-1",
    linearIssueDescription: null,
    linearIssueTitle: "Some title",
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
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
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

  it("renders the loading state and does not render RunsTable", () => {
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

  it("renders the error state and does not render RunsTable", () => {
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

  it("renders RunsTable with an empty array when there is no data", () => {
    mockUseRuns.mockReturnValue({
      runs: [],
      loading: false,
      error: null,
      refetch: vi.fn(),
    });

    render(<DashboardPage />);

    const table = screen.getByTestId("runs-table");
    expect(table.getAttribute("data-count")).toBe("0");
    // All stat counts (Total, Active, Awaiting, Blocked, Done) should be 0.
    expect(screen.getAllByText("0")).toHaveLength(5);
  });

  it("renders RunsTable with populated data and correct stat counts", () => {
    const runs = [
      makeRun({ id: "r-todo", state: "Todo" }), // idle
      makeRun({ id: "r-planning", state: "Planning" }), // active
      makeRun({ id: "r-awaiting", state: "AwaitingPlanApproval" }), // waiting
      makeRun({ id: "r-blocked", state: "AIBlocked" }), // blocked
      makeRun({ id: "r-done", state: "Done" }), // done
      makeRun({ id: "r-unknown", state: "SomeUnmappedState" }), // falls back to idle
    ];
    mockUseRuns.mockReturnValue({
      runs,
      loading: false,
      error: null,
      refetch: vi.fn(),
    });

    render(<DashboardPage />);

    const table = screen.getByTestId("runs-table");
    expect(table.getAttribute("data-count")).toBe("6");

    // Total stat.
    expect(screen.getByText("6")).toBeDefined();
    // Active, Awaiting, Blocked, Done counts are each 1; the unmapped state
    // falls back to "idle" and does not increment any of those four buckets.
    expect(screen.getAllByText("1")).toHaveLength(4);
  });

  it("filters runs passed to RunsTable when a filter button is clicked", async () => {
    const runs = [
      makeRun({ id: "r-active", state: "Planning" }),
      makeRun({ id: "r-done", state: "Done" }),
    ];
    mockUseRuns.mockReturnValue({
      runs,
      loading: false,
      error: null,
      refetch: vi.fn(),
    });

    render(<DashboardPage />);

    expect(screen.getByTestId("runs-table").getAttribute("data-count")).toBe(
      "2",
    );

    await userEvent.click(screen.getByRole("button", { name: "Done" }));

    expect(screen.getByTestId("runs-table").getAttribute("data-count")).toBe(
      "1",
    );
    expect(screen.getByText("r-done")).toBeDefined();
    expect(screen.queryByText("r-active")).toBeNull();
  });

  it("calls refetch when RunsTable triggers onAction", async () => {
    const refetch = vi.fn();
    mockUseRuns.mockReturnValue({
      runs: [makeRun({ id: "r-1" })],
      loading: false,
      error: null,
      refetch,
    });

    render(<DashboardPage />);
    await userEvent.click(screen.getByText("trigger-action"));

    expect(refetch).toHaveBeenCalledTimes(1);
  });

  it("opens the LinearSyncDialog when 'Sync from Linear' is clicked", async () => {
    mockUseRuns.mockReturnValue({
      runs: [],
      loading: false,
      error: null,
      refetch: vi.fn(),
    });

    render(<DashboardPage />);

    expect(
      screen.getByTestId("linear-sync-dialog").getAttribute("data-open"),
    ).toBe("false");

    await userEvent.click(
      screen.getByRole("button", { name: /sync from linear/i }),
    );

    expect(
      screen.getByTestId("linear-sync-dialog").getAttribute("data-open"),
    ).toBe("true");
  });

  it("closes the dialog when onClose fires", async () => {
    mockUseRuns.mockReturnValue({
      runs: [],
      loading: false,
      error: null,
      refetch: vi.fn(),
    });

    render(<DashboardPage />);
    await userEvent.click(
      screen.getByRole("button", { name: /sync from linear/i }),
    );
    expect(
      screen.getByTestId("linear-sync-dialog").getAttribute("data-open"),
    ).toBe("true");

    await userEvent.click(screen.getByText("close-dialog"));

    expect(
      screen.getByTestId("linear-sync-dialog").getAttribute("data-open"),
    ).toBe("false");
  });

  it("calls refetch when the dialog reports onIngested", async () => {
    const refetch = vi.fn();
    mockUseRuns.mockReturnValue({
      runs: [],
      loading: false,
      error: null,
      refetch,
    });

    render(<DashboardPage />);
    await userEvent.click(screen.getByText("trigger-ingested"));

    expect(refetch).toHaveBeenCalledTimes(1);
  });

  it("shows the IngestSummaryBanner with counts after onIngestComplete fires, and allows dismissal", async () => {
    mockUseRuns.mockReturnValue({
      runs: [],
      loading: false,
      error: null,
      refetch: vi.fn(),
    });

    render(<DashboardPage />);

    expect(screen.queryByTestId("ingest-summary-banner")).toBeNull();

    await userEvent.click(screen.getByText("trigger-ingest-complete"));

    const banner = screen.getByTestId("ingest-summary-banner");
    expect(banner.textContent).toContain("started:3");
    expect(banner.textContent).toContain("skipped:1");

    await userEvent.click(screen.getByText("dismiss-banner"));
    expect(screen.queryByTestId("ingest-summary-banner")).toBeNull();
  });

  it("auto-dismisses the IngestSummaryBanner after the timeout elapses", () => {
    vi.useFakeTimers();
    mockUseRuns.mockReturnValue({
      runs: [],
      loading: false,
      error: null,
      refetch: vi.fn(),
    });

    render(<DashboardPage />);

    fireEvent.click(screen.getByText("trigger-ingest-complete"));
    expect(screen.getByTestId("ingest-summary-banner")).toBeDefined();

    act(() => {
      vi.advanceTimersByTime(5000);
    });

    expect(screen.queryByTestId("ingest-summary-banner")).toBeNull();
  });
});
