import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, act, fireEvent } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { Run } from "@/api/client.ts";

vi.mock("@/hooks/useRuns.ts", () => ({
  useRuns: vi.fn(),
}));

vi.mock("@/components/RunsTable.tsx", () => ({
  RunsTable: ({ runs }: { runs: Run[] }) => (
    <div data-testid="runs-table">{runs.map((r) => r.id).join(",")}</div>
  ),
}));

vi.mock("@/components/LinearSyncDialog.tsx", () => ({
  LinearSyncDialog: ({
    open,
    onClose,
    onIngestComplete,
  }: {
    open: boolean;
    onClose: () => void;
    onIngestComplete: (s: { started: number; skipped: number }) => void;
  }) => (
    <div data-testid="sync-dialog">
      {open && <span>sync dialog open</span>}
      <button onClick={() => onIngestComplete({ started: 3, skipped: 1 })}>
        trigger-ingest-complete
      </button>
      <button onClick={onClose}>close-sync-dialog</button>
    </div>
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
      started {started} skipped {skipped}
      <button onClick={onDismiss}>dismiss-banner</button>
    </div>
  ),
}));

import { DashboardPage } from "./DashboardPage";
import { useRuns } from "@/hooks/useRuns.ts";

const mockUseRuns = useRuns as unknown as ReturnType<typeof vi.fn>;

function makeRun(id: string, state: string): Run {
  return {
    id,
    linearIssueId: "issue-1",
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
    createdAt: "2026-01-01T00:00:00Z",
    updatedAt: "2026-01-01T00:00:00Z",
  };
}

describe("DashboardPage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("shows a loading indicator while runs are loading", () => {
    mockUseRuns.mockReturnValue({ runs: [], loading: true, error: null, refetch: vi.fn() });
    render(<DashboardPage />);
    expect(screen.getByText(/Loading runs/i)).toBeDefined();
    expect(screen.queryByTestId("runs-table")).toBeNull();
  });

  it("shows an error message when the runs fetch fails", () => {
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

  it("renders the RunsTable with all runs when loaded without a filter", () => {
    const runs = [makeRun("r1", "Planning"), makeRun("r2", "Done")];
    mockUseRuns.mockReturnValue({ runs, loading: false, error: null, refetch: vi.fn() });
    render(<DashboardPage />);
    expect(screen.getByTestId("runs-table").textContent).toBe("r1,r2");
  });

  it("computes per-category counts in the stats bar", () => {
    const runs = [
      makeRun("r1", "Planning"), // active
      makeRun("r2", "Implementing"), // active
      makeRun("r3", "AwaitingPlanApproval"), // waiting
      makeRun("r4", "AIBlocked"), // blocked
      makeRun("r5", "Done"), // done
      makeRun("r6", "SomeTotallyUnknownState"), // falls back to "idle"
    ];
    mockUseRuns.mockReturnValue({ runs, loading: false, error: null, refetch: vi.fn() });
    const { container } = render(<DashboardPage />);

    const labels = Array.from(container.querySelectorAll(".text-xs.text-text-muted.mt-0\\.5"));
    const byLabel = Object.fromEntries(
      labels.map((el) => [el.textContent, el.previousSibling?.textContent]),
    );
    expect(byLabel["Total"]).toBe("6");
    expect(byLabel["Active"]).toBe("2");
    expect(byLabel["Awaiting"]).toBe("1");
    expect(byLabel["Blocked"]).toBe("1");
    expect(byLabel["Done"]).toBe("1");
  });

  it("filters the displayed runs when a filter button is clicked", async () => {
    const runs = [
      makeRun("r1", "Planning"), // active
      makeRun("r2", "Done"), // done
    ];
    mockUseRuns.mockReturnValue({ runs, loading: false, error: null, refetch: vi.fn() });
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
    mockUseRuns.mockReturnValue({ runs: [], loading: false, error: null, refetch: vi.fn() });
    render(<DashboardPage />);

    expect(screen.queryByText("sync dialog open")).toBeNull();
    await userEvent.click(screen.getByRole("button", { name: /sync from linear/i }));
    expect(screen.getByText("sync dialog open")).toBeDefined();

    await userEvent.click(screen.getByRole("button", { name: "close-sync-dialog" }));
    expect(screen.queryByText("sync dialog open")).toBeNull();
  });

  it("shows the ingest summary banner after onIngestComplete fires, then auto-dismisses it", async () => {
    vi.useFakeTimers();
    mockUseRuns.mockReturnValue({ runs: [], loading: false, error: null, refetch: vi.fn() });

    render(<DashboardPage />);
    act(() => {
      fireEvent.click(screen.getByRole("button", { name: "trigger-ingest-complete" }));
    });

    expect(screen.getByTestId("ingest-banner").textContent).toContain("started 3 skipped 1");

    await act(async () => {
      vi.advanceTimersByTime(5000);
    });
    expect(screen.queryByTestId("ingest-banner")).toBeNull();

    vi.useRealTimers();
  });

  it("dismisses the ingest summary banner immediately when onDismiss is invoked", async () => {
    mockUseRuns.mockReturnValue({ runs: [], loading: false, error: null, refetch: vi.fn() });
    render(<DashboardPage />);

    await userEvent.click(screen.getByRole("button", { name: "trigger-ingest-complete" }));
    expect(screen.getByTestId("ingest-banner")).toBeDefined();

    await userEvent.click(screen.getByRole("button", { name: "dismiss-banner" }));
    expect(screen.queryByTestId("ingest-banner")).toBeNull();
  });
});
