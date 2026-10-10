import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, within, act, fireEvent } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import type { Run } from "@/api/client.ts";

// --- Mock the data hook so we control loading/error/runs/refetch directly ---
vi.mock("@/hooks/useRuns.ts", () => ({
  useRuns: vi.fn(),
}));

// --- Mock LinearSyncDialog with a minimal stand-in that exposes its props
// through a captured variable and some test buttons, so we can drive its
// callbacks without the real dialog's fetch/SSE machinery. ---
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
    if (!props.open) return null;
    return (
      <div data-testid="sync-dialog">
        <button data-testid="sync-close" onClick={props.onClose}>
          close
        </button>
        <button data-testid="sync-ingested" onClick={props.onIngested}>
          ingested
        </button>
        <button
          data-testid="sync-complete"
          onClick={() => props.onIngestComplete?.({ started: 3, skipped: 1 })}
        >
          complete
        </button>
      </div>
    );
  },
}));

// --- Mock IngestSummaryBanner similarly ---
let capturedBannerProps: {
  started: number;
  skipped: number;
  onDismiss: () => void;
} | null = null;

vi.mock("@/components/IngestSummaryBanner.tsx", () => ({
  IngestSummaryBanner: (props: {
    started: number;
    skipped: number;
    onDismiss: () => void;
  }) => {
    capturedBannerProps = props;
    return (
      <div data-testid="ingest-banner">
        started={props.started} skipped={props.skipped}
        <button data-testid="banner-dismiss" onClick={props.onDismiss}>
          dismiss
        </button>
      </div>
    );
  },
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
    linearIssueTitle: "Fix the thing",
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
    workingDirectory: "/tmp/work",
    latestArtifactVersion: 1,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}

function renderPage() {
  return render(
    <MemoryRouter>
      <DashboardPage />
    </MemoryRouter>,
  );
}

function defaultRunsResult(overrides: Partial<ReturnType<typeof mockUseRuns>> = {}) {
  return {
    runs: [] as Run[],
    loading: false,
    error: null as string | null,
    refetch: vi.fn(),
    ...overrides,
  };
}

describe("DashboardPage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    capturedSyncProps = null;
    capturedBannerProps = null;
    mockUseRuns.mockReturnValue(defaultRunsResult());
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("shows a loading state while useRuns is loading", () => {
    mockUseRuns.mockReturnValue(defaultRunsResult({ loading: true }));
    renderPage();

    expect(screen.getByText(/loading runs/i)).toBeDefined();
    expect(screen.queryByText(/no runs found/i)).toBeNull();
  });

  it("shows an error message when useRuns errors", () => {
    mockUseRuns.mockReturnValue(
      defaultRunsResult({ error: "Failed to fetch runs" }),
    );
    renderPage();

    expect(screen.getByText("Failed to fetch runs")).toBeDefined();
  });

  it("renders the stats bar computed from run states", () => {
    const runs = [
      makeRun({ id: "r1", state: "Implementing" }), // active
      makeRun({ id: "r1b", state: "Planning" }), // also active — exercises the
      // reduce's "category already seen" accumulation path, not just the
      // nullish-coalescing default-to-0 path.
      makeRun({ id: "r2", state: "AwaitingPlanApproval" }), // waiting
      makeRun({ id: "r3", state: "AIBlocked" }), // blocked
      makeRun({ id: "r4", state: "Done" }), // done
      makeRun({ id: "r5", state: "Todo" }), // idle (not counted in any stat bucket shown)
      makeRun({ id: "r6", state: "SomeUnknownFutureState" }), // falls back to "idle"
    ];
    mockUseRuns.mockReturnValue(defaultRunsResult({ runs }));
    renderPage();

    // Scope to the stats grid (identified by the unambiguous "Total" label)
    // to avoid matching the filter bar's same-named buttons below it.
    const statsBar = screen.getByText("Total").parentElement!.parentElement!;
    const stats = within(statsBar);

    expect(stats.getByText("Total").parentElement!.textContent).toContain("7");
    expect(stats.getByText("Active").parentElement!.textContent).toContain("2");
    expect(stats.getByText("Awaiting").parentElement!.textContent).toContain("1");
    expect(stats.getByText("Blocked").parentElement!.textContent).toContain("1");
    expect(stats.getByText("Done").parentElement!.textContent).toContain("1");
  });

  it("renders RunsTable with all runs when the filter is All", () => {
    const runs = [
      makeRun({ id: "r1", linearIssueTitle: "Issue One", state: "Todo" }),
      makeRun({ id: "r2", linearIssueTitle: "Issue Two", state: "Done" }),
    ];
    mockUseRuns.mockReturnValue(defaultRunsResult({ runs }));
    renderPage();

    expect(screen.getByText("Issue One")).toBeDefined();
    expect(screen.getByText("Issue Two")).toBeDefined();
  });

  it("filters runs client-side when a category filter button is clicked", async () => {
    const user = userEvent.setup();
    const runs = [
      makeRun({ id: "r1", linearIssueTitle: "Active Issue", state: "Implementing" }),
      makeRun({ id: "r2", linearIssueTitle: "Done Issue", state: "Done" }),
    ];
    mockUseRuns.mockReturnValue(defaultRunsResult({ runs }));
    renderPage();

    // Sanity check: both present before filtering.
    expect(screen.getByText("Active Issue")).toBeDefined();
    expect(screen.getByText("Done Issue")).toBeDefined();

    await user.click(screen.getByRole("button", { name: "Active" }));

    expect(screen.getByText("Active Issue")).toBeDefined();
    expect(screen.queryByText("Done Issue")).toBeNull();
  });

  it("filters to the Done category and back to All", async () => {
    const user = userEvent.setup();
    const runs = [
      makeRun({ id: "r1", linearIssueTitle: "Active Issue", state: "Implementing" }),
      makeRun({ id: "r2", linearIssueTitle: "Done Issue", state: "Done" }),
    ];
    mockUseRuns.mockReturnValue(defaultRunsResult({ runs }));
    renderPage();

    await user.click(screen.getByRole("button", { name: "Done" }));
    expect(screen.queryByText("Active Issue")).toBeNull();
    expect(screen.getByText("Done Issue")).toBeDefined();

    await user.click(screen.getByRole("button", { name: "All" }));
    expect(screen.getByText("Active Issue")).toBeDefined();
    expect(screen.getByText("Done Issue")).toBeDefined();
  });

  it("filters to the Awaiting Human and Blocked categories", async () => {
    const user = userEvent.setup();
    const runs = [
      makeRun({ id: "r1", linearIssueTitle: "Waiting Issue", state: "ReadyForHumanReview" }),
      makeRun({ id: "r2", linearIssueTitle: "Blocked Issue", state: "AIBlocked" }),
    ];
    mockUseRuns.mockReturnValue(defaultRunsResult({ runs }));
    renderPage();

    await user.click(screen.getByRole("button", { name: "Awaiting Human" }));
    expect(screen.getByText("Waiting Issue")).toBeDefined();
    expect(screen.queryByText("Blocked Issue")).toBeNull();

    await user.click(screen.getByRole("button", { name: "Blocked" }));
    expect(screen.queryByText("Waiting Issue")).toBeNull();
    expect(screen.getByText("Blocked Issue")).toBeDefined();
  });

  it("shows the empty state when there are no runs after filtering", async () => {
    const user = userEvent.setup();
    const runs = [makeRun({ id: "r1", state: "Todo" })];
    mockUseRuns.mockReturnValue(defaultRunsResult({ runs }));
    renderPage();

    await user.click(screen.getByRole("button", { name: "Done" }));
    expect(screen.getByText(/no runs found/i)).toBeDefined();
  });

  it("opens the LinearSyncDialog when Sync from Linear is clicked, and closes it", async () => {
    const user = userEvent.setup();
    renderPage();

    expect(capturedSyncProps?.open).toBe(false);
    expect(screen.queryByTestId("sync-dialog")).toBeNull();

    await user.click(screen.getByRole("button", { name: /sync from linear/i }));
    expect(capturedSyncProps?.open).toBe(true);
    expect(screen.getByTestId("sync-dialog")).toBeDefined();

    await user.click(screen.getByTestId("sync-close"));
    expect(capturedSyncProps?.open).toBe(false);
    expect(screen.queryByTestId("sync-dialog")).toBeNull();
  });

  it("wires onIngested from the dialog to the useRuns refetch", async () => {
    const user = userEvent.setup();
    const refetch = vi.fn();
    mockUseRuns.mockReturnValue(defaultRunsResult({ refetch }));
    renderPage();

    await user.click(screen.getByRole("button", { name: /sync from linear/i }));
    await user.click(screen.getByTestId("sync-ingested"));

    expect(refetch).toHaveBeenCalledOnce();
  });

  it("shows the IngestSummaryBanner after onIngestComplete fires, with the right counts", async () => {
    const user = userEvent.setup();
    renderPage();

    expect(screen.queryByTestId("ingest-banner")).toBeNull();

    await user.click(screen.getByRole("button", { name: /sync from linear/i }));
    await user.click(screen.getByTestId("sync-complete"));

    expect(screen.getByTestId("ingest-banner")).toBeDefined();
    expect(capturedBannerProps?.started).toBe(3);
    expect(capturedBannerProps?.skipped).toBe(1);
  });

  it("auto-dismisses the ingest banner after INGEST_BANNER_AUTO_DISMISS_MS", () => {
    vi.useFakeTimers();
    renderPage();

    // Use fireEvent (not userEvent) here: userEvent's internal scheduling
    // doesn't play well with fully-faked timers, but these are plain
    // synchronous button clicks with no debounce/async behavior to simulate.
    fireEvent.click(screen.getByRole("button", { name: /sync from linear/i }));
    fireEvent.click(screen.getByTestId("sync-complete"));
    expect(screen.getByTestId("ingest-banner")).toBeDefined();

    act(() => {
      vi.advanceTimersByTime(4999);
    });
    expect(screen.getByTestId("ingest-banner")).toBeDefined();

    act(() => {
      vi.advanceTimersByTime(1);
    });
    expect(screen.queryByTestId("ingest-banner")).toBeNull();
  });

  it("dismisses the ingest banner manually and cancels the pending auto-dismiss timer", () => {
    vi.useFakeTimers();
    renderPage();

    fireEvent.click(screen.getByRole("button", { name: /sync from linear/i }));
    fireEvent.click(screen.getByTestId("sync-complete"));
    expect(screen.getByTestId("ingest-banner")).toBeDefined();

    fireEvent.click(within(screen.getByTestId("ingest-banner")).getByTestId("banner-dismiss"));
    expect(screen.queryByTestId("ingest-banner")).toBeNull();

    // Advancing past the auto-dismiss window should not throw or resurrect it,
    // confirming the timeout was cleared rather than merely racing a re-set.
    act(() => {
      vi.advanceTimersByTime(10_000);
    });
    expect(screen.queryByTestId("ingest-banner")).toBeNull();
  });

  it("passes onAction (refetch) through to RunsTable so row actions can refresh the list", () => {
    // RunsTable renders real; its "Approve Plan" action button only appears
    // for AwaitingPlanApproval runs, confirming the filtered run reached it.
    const runs = [makeRun({ id: "r1", state: "AwaitingPlanApproval" })];
    mockUseRuns.mockReturnValue(defaultRunsResult({ runs }));
    renderPage();

    expect(screen.getByTitle("Approve Plan")).toBeDefined();
  });
});
