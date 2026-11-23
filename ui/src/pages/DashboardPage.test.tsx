import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor, act } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { Run } from "@/api/client.ts";

const useRunsMock = vi.fn();
vi.mock("@/hooks/useRuns.ts", () => ({
  useRuns: () => useRunsMock(),
}));

vi.mock("@/components/RunsTable.tsx", () => ({
  RunsTable: ({ runs, onAction }: { runs: Run[]; onAction: () => void }) => (
    <div data-testid="runs-table">
      <span data-testid="runs-count">{runs.length}</span>
      <button onClick={onAction}>trigger-action</button>
    </div>
  ),
}));

type SyncDialogProps = {
  open: boolean;
  onClose: () => void;
  onIngested: () => void;
  onIngestComplete?: (s: { started: number; skipped: number }) => void;
};

vi.mock("@/components/LinearSyncDialog.tsx", () => ({
  LinearSyncDialog: (props: SyncDialogProps) => {
    if (!props.open) return null;
    return (
      <div data-testid="sync-dialog">
        <button onClick={props.onClose}>close-dialog</button>
        <button onClick={props.onIngested}>fire-ingested</button>
        <button onClick={() => props.onIngestComplete?.({ started: 3, skipped: 1 })}>
          fire-ingest-complete
        </button>
      </div>
    );
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
    linearIssueTitle: "Fix the thing",
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
    workingDirectory: "/tmp/work",
    latestArtifactVersion: 0,
    createdAt: "2026-01-01T00:00:00Z",
    updatedAt: "2026-01-01T00:00:00Z",
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
    useRunsMock.mockReturnValue({ runs: [], loading: true, error: null, refetch: vi.fn() });
    render(<DashboardPage />);
    expect(screen.getByText(/loading runs/i)).toBeDefined();
    expect(screen.queryByTestId("runs-table")).toBeNull();
  });

  it("shows an error message instead of the table when loading failed", () => {
    useRunsMock.mockReturnValue({
      runs: [],
      loading: false,
      error: "Network unreachable",
      refetch: vi.fn(),
    });
    render(<DashboardPage />);
    expect(screen.getByText("Network unreachable")).toBeDefined();
    expect(screen.queryByTestId("runs-table")).toBeNull();
  });

  it("computes stat counts per state category and renders the table with all runs by default", () => {
    const runs = [
      makeRun({ id: "r1", state: "Implementing" }), // active
      makeRun({ id: "r2", state: "AwaitingPlanApproval" }), // waiting
      makeRun({ id: "r3", state: "Done" }), // done
      makeRun({ id: "r4", state: "AIBlocked" }), // blocked
    ];
    useRunsMock.mockReturnValue({ runs, loading: false, error: null, refetch: vi.fn() });
    render(<DashboardPage />);

    expect(screen.getByTestId("runs-count").textContent).toBe("4");
    // Stat tiles: Total, Active, Awaiting, Blocked, Done. "Active" and "Done"
    // also appear as filter button labels, so scope to the stat-label divs.
    function statValue(label: string): string | null | undefined {
      const el = screen
        .getAllByText(label)
        .find((n) => n.tagName === "DIV" && n.className.includes("text-text-muted mt-0.5"));
      return el?.previousSibling?.textContent;
    }
    expect(statValue("Total")).toBe("4");
    expect(statValue("Active")).toBe("1");
    expect(statValue("Awaiting")).toBe("1");
    expect(statValue("Blocked")).toBe("1");
    expect(statValue("Done")).toBe("1");
  });

  it("buckets a run with an unrecognized state as idle, not into any displayed category", () => {
    const runs = [
      makeRun({ id: "r1", state: "SomeFutureState" }),
      makeRun({ id: "r2", state: "Implementing" }), // active
    ];
    useRunsMock.mockReturnValue({ runs, loading: false, error: null, refetch: vi.fn() });
    render(<DashboardPage />);

    function statValue(label: string): string | null | undefined {
      const el = screen
        .getAllByText(label)
        .find((n) => n.tagName === "DIV" && n.className.includes("text-text-muted mt-0.5"));
      return el?.previousSibling?.textContent;
    }
    expect(statValue("Total")).toBe("2");
    expect(statValue("Active")).toBe("1");
    expect(statValue("Awaiting")).toBe("0");
    expect(statValue("Blocked")).toBe("0");
    expect(statValue("Done")).toBe("0");
  });

  it("filters the runs passed to RunsTable when a filter button is clicked", async () => {
    const runs = [
      makeRun({ id: "r1", state: "Implementing" }), // active
      makeRun({ id: "r2", state: "Done" }), // done
    ];
    useRunsMock.mockReturnValue({ runs, loading: false, error: null, refetch: vi.fn() });
    render(<DashboardPage />);

    expect(screen.getByTestId("runs-count").textContent).toBe("2");

    await userEvent.click(screen.getByRole("button", { name: "Active" }));
    expect(screen.getByTestId("runs-count").textContent).toBe("1");

    await userEvent.click(screen.getByRole("button", { name: "All" }));
    expect(screen.getByTestId("runs-count").textContent).toBe("2");
  });

  it("opens the Linear sync dialog when 'Sync from Linear' is clicked and closes it via onClose", async () => {
    useRunsMock.mockReturnValue({ runs: [], loading: false, error: null, refetch: vi.fn() });
    render(<DashboardPage />);

    expect(screen.queryByTestId("sync-dialog")).toBeNull();
    await userEvent.click(screen.getByRole("button", { name: /sync from linear/i }));
    expect(screen.getByTestId("sync-dialog")).toBeDefined();

    await userEvent.click(screen.getByText("close-dialog"));
    expect(screen.queryByTestId("sync-dialog")).toBeNull();
  });

  it("calls refetch when the dialog reports onIngested, and when RunsTable reports an action", async () => {
    const refetch = vi.fn();
    useRunsMock.mockReturnValue({ runs: [], loading: false, error: null, refetch });
    render(<DashboardPage />);

    await userEvent.click(screen.getByText("trigger-action"));
    expect(refetch).toHaveBeenCalledTimes(1);

    await userEvent.click(screen.getByRole("button", { name: /sync from linear/i }));
    await userEvent.click(screen.getByText("fire-ingested"));
    expect(refetch).toHaveBeenCalledTimes(2);
  });

  it("shows the ingest summary banner after onIngestComplete, dismissible, and auto-dismisses after 5s", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    useRunsMock.mockReturnValue({ runs: [], loading: false, error: null, refetch: vi.fn() });
    render(<DashboardPage />);

    await user.click(screen.getByRole("button", { name: /sync from linear/i }));
    await user.click(screen.getByText("fire-ingest-complete"));

    expect(screen.getByTestId("ingest-banner").textContent).toContain("Started 3, skipped 1");

    await user.click(screen.getByText("dismiss-banner"));
    expect(screen.queryByTestId("ingest-banner")).toBeNull();

    // Re-trigger and let the auto-dismiss timer run out instead of clicking dismiss.
    await user.click(screen.getByText("fire-ingest-complete"));
    expect(screen.getByTestId("ingest-banner")).toBeDefined();

    await act(async () => {
      vi.advanceTimersByTime(5001);
    });

    await waitFor(() => expect(screen.queryByTestId("ingest-banner")).toBeNull());
  });
});
