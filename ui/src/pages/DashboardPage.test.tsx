import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup, act } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { DashboardPage } from "./DashboardPage.tsx";
import type { Run } from "@/api/client.ts";

vi.mock("@/hooks/useRuns.ts", () => ({
  useRuns: vi.fn(),
}));

vi.mock("@/components/RunsTable.tsx", () => ({
  RunsTable: (props: { runs: Run[]; onAction?: () => void }) => (
    <div data-testid="runs-table" data-count={props.runs.length}>
      <button onClick={props.onAction}>trigger-action</button>
    </div>
  ),
}));

vi.mock("@/components/LinearSyncDialog.tsx", () => ({
  LinearSyncDialog: (props: {
    open: boolean;
    onClose: () => void;
    onIngested: () => void;
    onIngestComplete: (s: { started: number; skipped: number }) => void;
  }) => (
    <div data-testid="linear-sync-dialog" data-open={String(props.open)}>
      <button onClick={props.onClose}>close-dialog</button>
      <button onClick={props.onIngested}>fire-ingested</button>
      <button onClick={() => props.onIngestComplete({ started: 3, skipped: 1 })}>
        fire-ingest-complete
      </button>
    </div>
  ),
}));

vi.mock("@/components/IngestSummaryBanner.tsx", () => ({
  IngestSummaryBanner: (props: {
    started: number;
    skipped: number;
    onDismiss: () => void;
  }) => (
    <div data-testid="ingest-banner">
      Started {props.started} skipped {props.skipped}
      <button onClick={props.onDismiss}>dismiss-banner</button>
    </div>
  ),
}));

import { useRuns } from "@/hooks/useRuns.ts";

const mockUseRuns = useRuns as unknown as ReturnType<typeof vi.fn>;

function makeRun(overrides: Partial<Run>): Run {
  return {
    id: "run-1",
    linearIssueId: "issue-1",
    linearIssueIdentifier: "ENG-1",
    linearIssueDescription: null,
    linearIssueTitle: "Some issue",
    linearIssueUrl: null,
    repo: "acme/widgets",
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
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}

const FIVE_RUNS: Run[] = [
  makeRun({ id: "r-idle", state: "Todo" }),
  makeRun({ id: "r-active", state: "Planning" }),
  makeRun({ id: "r-waiting", state: "AwaitingPlanApproval" }),
  makeRun({ id: "r-blocked", state: "AIBlocked" }),
  makeRun({ id: "r-done", state: "Done" }),
];

describe("DashboardPage", () => {
  beforeEach(() => {
    mockUseRuns.mockReset();
  });

  afterEach(() => {
    cleanup();
    vi.useRealTimers();
  });

  it("shows a loading indicator and no table while loading", () => {
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

  it("shows the error message and no table when the fetch fails", () => {
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

  it("renders per-category counts and passes all runs to the table by default", () => {
    mockUseRuns.mockReturnValue({
      runs: FIVE_RUNS,
      loading: false,
      error: null,
      refetch: vi.fn(),
    });

    render(<DashboardPage />);

    // Total stat
    expect(screen.getByText("5")).toBeDefined();
    // One run in each of active/waiting/blocked/done categories
    expect(screen.getAllByText("1")).toHaveLength(4);

    const table = screen.getByTestId("runs-table");
    expect(table.getAttribute("data-count")).toBe("5");
  });

  it("falls back to the idle category for a run whose state is not in the mapping", () => {
    mockUseRuns.mockReturnValue({
      runs: [makeRun({ id: "r-unmapped", state: "SomeUnknownState" })],
      loading: false,
      error: null,
      refetch: vi.fn(),
    });

    render(<DashboardPage />);

    // Total reflects the one run, but it doesn't bump active/waiting/blocked/done.
    expect(screen.getByText("1")).toBeDefined();
    expect(screen.getAllByText("0")).toHaveLength(4);
  });

  it("filters the runs passed to the table when a filter chip is clicked", async () => {
    const user = userEvent.setup();
    mockUseRuns.mockReturnValue({
      runs: FIVE_RUNS,
      loading: false,
      error: null,
      refetch: vi.fn(),
    });

    render(<DashboardPage />);

    await user.click(screen.getByRole("button", { name: "Blocked" }));

    const table = screen.getByTestId("runs-table");
    expect(table.getAttribute("data-count")).toBe("1");

    await user.click(screen.getByRole("button", { name: "All" }));
    expect(screen.getByTestId("runs-table").getAttribute("data-count")).toBe("5");
  });

  it("calls refetch when the table reports an action", async () => {
    const user = userEvent.setup();
    const refetch = vi.fn();
    mockUseRuns.mockReturnValue({
      runs: FIVE_RUNS,
      loading: false,
      error: null,
      refetch,
    });

    render(<DashboardPage />);

    await user.click(screen.getByRole("button", { name: "trigger-action" }));

    expect(refetch).toHaveBeenCalledOnce();
  });

  it("opens the Linear sync dialog from the header button", async () => {
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

    await user.click(screen.getByRole("button", { name: "close-dialog" }));

    expect(screen.getByTestId("linear-sync-dialog").getAttribute("data-open")).toBe(
      "false",
    );
  });

  it("shows the ingest summary banner after ingestion completes, dismissible manually", async () => {
    const user = userEvent.setup();
    const refetch = vi.fn();
    mockUseRuns.mockReturnValue({
      runs: [],
      loading: false,
      error: null,
      refetch,
    });

    render(<DashboardPage />);

    expect(screen.queryByTestId("ingest-banner")).toBeNull();

    await user.click(screen.getByRole("button", { name: "fire-ingest-complete" }));

    expect(screen.getByTestId("ingest-banner").textContent).toContain(
      "Started 3 skipped 1",
    );

    await user.click(screen.getByRole("button", { name: "dismiss-banner" }));

    expect(screen.queryByTestId("ingest-banner")).toBeNull();
  });

  it("auto-dismisses the ingest summary banner after the timeout elapses", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    mockUseRuns.mockReturnValue({
      runs: [],
      loading: false,
      error: null,
      refetch: vi.fn(),
    });

    render(<DashboardPage />);

    await user.click(screen.getByRole("button", { name: "fire-ingest-complete" }));
    expect(screen.getByTestId("ingest-banner")).toBeDefined();

    await act(async () => {
      vi.advanceTimersByTime(5000);
    });

    expect(screen.queryByTestId("ingest-banner")).toBeNull();
  });

  it("propagates onIngested from the dialog to refetch runs", async () => {
    const user = userEvent.setup();
    const refetch = vi.fn();
    mockUseRuns.mockReturnValue({
      runs: [],
      loading: false,
      error: null,
      refetch,
    });

    render(<DashboardPage />);

    await user.click(screen.getByRole("button", { name: "fire-ingested" }));

    expect(refetch).toHaveBeenCalledOnce();
  });
});
