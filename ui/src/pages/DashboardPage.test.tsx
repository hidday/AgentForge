import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, within, act } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { Run } from "@/api/client.ts";

const { useRunsMock, runsTableSpy, dialogSpy, bannerSpy } = vi.hoisted(() => ({
  useRunsMock: vi.fn(),
  runsTableSpy: vi.fn(),
  dialogSpy: vi.fn(),
  bannerSpy: vi.fn(),
}));

vi.mock("@/hooks/useRuns.ts", () => ({
  useRuns: (...args: unknown[]) => useRunsMock(...args),
}));

vi.mock("@/components/RunsTable.tsx", () => ({
  RunsTable: (props: { runs: Run[]; onAction?: () => void }) => {
    runsTableSpy(props);
    return <div data-testid="runs-table">{props.runs.length} rows</div>;
  },
}));

vi.mock("@/components/LinearSyncDialog.tsx", () => ({
  LinearSyncDialog: (props: {
    open: boolean;
    onClose: () => void;
    onIngested: () => void;
    onIngestComplete?: (s: { started: number; skipped: number }) => void;
  }) => {
    dialogSpy(props);
    if (!props.open) return null;
    return (
      <div data-testid="linear-sync-dialog">
        <button onClick={() => props.onIngestComplete?.({ started: 2, skipped: 1 })}>
          Simulate Ingest Complete
        </button>
        <button onClick={props.onClose}>Close Dialog</button>
      </div>
    );
  },
}));

vi.mock("@/components/IngestSummaryBanner.tsx", () => ({
  IngestSummaryBanner: (props: {
    started: number;
    skipped: number;
    onDismiss: () => void;
  }) => {
    bannerSpy(props);
    return (
      <div role="status">
        Started {props.started} runs, skipped {props.skipped}
        <button onClick={props.onDismiss}>Dismiss</button>
      </div>
    );
  },
}));

import { DashboardPage } from "./DashboardPage.tsx";

function makeRun(overrides: Partial<Run>): Run {
  return {
    id: "run-default",
    linearIssueId: "issue-default",
    linearIssueIdentifier: null,
    linearIssueDescription: null,
    linearIssueTitle: null,
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
    workingDirectory: "/tmp",
    latestArtifactVersion: 1,
    createdAt: "2024-01-01T00:00:00Z",
    updatedAt: "2024-01-01T00:00:00Z",
    ...overrides,
  };
}

function getStatValue(label: string): string | null {
  // Several labels (e.g. "Blocked") are reused by the filter bar below the
  // stats grid, so scope the lookup to the stats grid container.
  const grid = document.querySelector(".grid-cols-5");
  if (!grid) throw new Error("stats grid not found");
  const labelEl = within(grid as HTMLElement).getByText(label);
  return labelEl.previousElementSibling?.textContent ?? null;
}

describe("DashboardPage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("shows a loading indicator and does not render the runs table while loading", () => {
    useRunsMock.mockReturnValue({ runs: [], loading: true, error: null, refetch: vi.fn() });
    render(<DashboardPage />);

    expect(screen.getByText(/loading runs/i)).toBeDefined();
    expect(runsTableSpy).not.toHaveBeenCalled();
  });

  it("shows an error message and does not render the runs table on error", () => {
    useRunsMock.mockReturnValue({
      runs: [],
      loading: false,
      error: "Could not reach server",
      refetch: vi.fn(),
    });
    render(<DashboardPage />);

    expect(screen.getByText("Could not reach server")).toBeDefined();
    expect(runsTableSpy).not.toHaveBeenCalled();
  });

  it("renders stat counts per category and passes all runs to the table by default", () => {
    const refetch = vi.fn();
    const runs = [
      makeRun({ id: "r1", state: "Planning" }), // active
      makeRun({ id: "r2", state: "Implementing" }), // active
      makeRun({ id: "r3", state: "AwaitingPlanApproval" }), // waiting
      makeRun({ id: "r4", state: "AIBlocked" }), // blocked
      makeRun({ id: "r5", state: "Done" }), // done
      makeRun({ id: "r6", state: "Todo" }), // idle (not shown as its own tile)
    ];
    useRunsMock.mockReturnValue({ runs, loading: false, error: null, refetch });

    render(<DashboardPage />);

    expect(getStatValue("Total")).toBe("6");
    expect(getStatValue("Active")).toBe("2");
    expect(getStatValue("Awaiting")).toBe("1");
    expect(getStatValue("Blocked")).toBe("1");
    expect(getStatValue("Done")).toBe("1");

    expect(runsTableSpy).toHaveBeenLastCalledWith(
      expect.objectContaining({ runs, onAction: refetch }),
    );
  });

  it("filters the table to only the selected category when a filter button is clicked", async () => {
    const runs = [
      makeRun({ id: "r1", state: "Planning" }), // active
      makeRun({ id: "r2", state: "AwaitingPlanApproval" }), // waiting
      makeRun({ id: "r3", state: "Done" }), // done
    ];
    useRunsMock.mockReturnValue({ runs, loading: false, error: null, refetch: vi.fn() });

    render(<DashboardPage />);

    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "Active" }));

    expect(runsTableSpy).toHaveBeenLastCalledWith(
      expect.objectContaining({ runs: [runs[0]] }),
    );
  });

  it("opens the Linear sync dialog when 'Sync from Linear' is clicked", async () => {
    useRunsMock.mockReturnValue({ runs: [], loading: false, error: null, refetch: vi.fn() });
    render(<DashboardPage />);

    expect(dialogSpy).toHaveBeenLastCalledWith(expect.objectContaining({ open: false }));

    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: /sync from linear/i }));

    expect(dialogSpy).toHaveBeenLastCalledWith(expect.objectContaining({ open: true }));
    expect(screen.getByTestId("linear-sync-dialog")).toBeDefined();
  });

  it("shows the ingest summary banner with correct counts after an ingest completes", async () => {
    useRunsMock.mockReturnValue({ runs: [], loading: false, error: null, refetch: vi.fn() });
    render(<DashboardPage />);

    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: /sync from linear/i }));
    await user.click(screen.getByRole("button", { name: /simulate ingest complete/i }));

    expect(bannerSpy).toHaveBeenLastCalledWith(
      expect.objectContaining({ started: 2, skipped: 1 }),
    );
    expect(screen.getByText(/started 2 runs, skipped 1/i)).toBeDefined();
  });

  it("dismisses the ingest summary banner when its dismiss button is clicked", async () => {
    useRunsMock.mockReturnValue({ runs: [], loading: false, error: null, refetch: vi.fn() });
    render(<DashboardPage />);

    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: /sync from linear/i }));
    await user.click(screen.getByRole("button", { name: /simulate ingest complete/i }));
    expect(screen.getByText(/started 2 runs/i)).toBeDefined();

    await user.click(screen.getByRole("button", { name: "Dismiss" }));

    expect(screen.queryByText(/started 2 runs/i)).toBeNull();
  });

  it("auto-dismisses the ingest summary banner after the timeout elapses", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    useRunsMock.mockReturnValue({ runs: [], loading: false, error: null, refetch: vi.fn() });
    render(<DashboardPage />);

    await user.click(screen.getByRole("button", { name: /sync from linear/i }));
    await user.click(screen.getByRole("button", { name: /simulate ingest complete/i }));
    expect(screen.getByText(/started 2 runs/i)).toBeDefined();

    await act(async () => {
      vi.advanceTimersByTime(5000);
    });

    expect(screen.queryByText(/started 2 runs/i)).toBeNull();
  });
});
