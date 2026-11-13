import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, within, act } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { Run } from "@/api/client.ts";

const mockUseRuns = vi.fn();
vi.mock("@/hooks/useRuns.ts", () => ({
  useRuns: () => mockUseRuns(),
}));

vi.mock("@/components/RunsTable.tsx", () => ({
  RunsTable: ({ runs, onAction }: { runs: Run[]; onAction?: () => void }) => (
    <div data-testid="runs-table">
      <span data-testid="runs-count">{runs.length}</span>
      <button onClick={onAction}>trigger-action</button>
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
      started:{started} skipped:{skipped}
      <button onClick={onDismiss}>dismiss</button>
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
  }) => (
    <div data-testid="linear-sync-dialog" data-open={open}>
      <button onClick={onClose}>close-dialog</button>
      <button onClick={onIngested}>fire-ingested</button>
      <button onClick={() => onIngestComplete({ started: 2, skipped: 1 })}>
        fire-ingest-complete
      </button>
    </div>
  ),
}));

import { DashboardPage } from "./DashboardPage.tsx";

function makeRun(overrides: Partial<Run> = {}): Run {
  return {
    id: "r1",
    linearIssueId: "li1",
    linearIssueIdentifier: null,
    linearIssueDescription: null,
    linearIssueTitle: null,
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
    workingDirectory: "/tmp",
    latestArtifactVersion: 0,
    createdAt: "2024-01-01T00:00:00Z",
    updatedAt: "2024-01-01T00:00:00Z",
    ...overrides,
  };
}

describe("DashboardPage", () => {
  beforeEach(() => {
    mockUseRuns.mockReset();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("shows a loading indicator while runs are loading", () => {
    mockUseRuns.mockReturnValue({ runs: [], loading: true, error: null, refetch: vi.fn() });
    render(<DashboardPage />);
    expect(screen.getByText(/loading runs/i)).toBeDefined();
    expect(screen.queryByTestId("runs-table")).toBeNull();
  });

  it("shows the error message instead of the table on error", () => {
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

  it("renders all runs in the table and correct stat counts by default filter", () => {
    const runs = [
      makeRun({ id: "r1", state: "Planning" }), // active
      makeRun({ id: "r2", state: "AwaitingPlanApproval" }), // waiting
      makeRun({ id: "r3", state: "AIBlocked" }), // blocked
      makeRun({ id: "r4", state: "Done" }), // done
      makeRun({ id: "r5", state: "Todo" }), // idle (no stat tile)
    ];
    mockUseRuns.mockReturnValue({ runs, loading: false, error: null, refetch: vi.fn() });
    const { container } = render(<DashboardPage />);

    expect(screen.getByTestId("runs-count").textContent).toBe("5");

    // The stats bar is the first grid; scope lookups to it since "Active"
    // etc. also appear as filter button labels elsewhere on the page.
    const statsBar = container.querySelector(".grid-cols-5") as HTMLElement;
    const statValue = (label: string) =>
      within(statsBar).getByText(label).previousSibling?.textContent;

    expect(statValue("Total")).toBe("5");
    expect(statValue("Active")).toBe("1");
    expect(statValue("Awaiting")).toBe("1");
    expect(statValue("Blocked")).toBe("1");
    expect(statValue("Done")).toBe("1");
  });

  it("filters the runs passed to the table when a category filter is clicked", async () => {
    const runs = [
      makeRun({ id: "r1", state: "Planning" }), // active
      makeRun({ id: "r2", state: "Done" }), // done
    ];
    mockUseRuns.mockReturnValue({ runs, loading: false, error: null, refetch: vi.fn() });
    render(<DashboardPage />);

    expect(screen.getByTestId("runs-count").textContent).toBe("2");

    await userEvent.click(screen.getByRole("button", { name: "Active" }));
    expect(screen.getByTestId("runs-count").textContent).toBe("1");

    await userEvent.click(screen.getByRole("button", { name: "Done" }));
    expect(screen.getByTestId("runs-count").textContent).toBe("1");

    await userEvent.click(screen.getByRole("button", { name: "All" }));
    expect(screen.getByTestId("runs-count").textContent).toBe("2");
  });

  it("opens the Linear sync dialog when 'Sync from Linear' is clicked", async () => {
    mockUseRuns.mockReturnValue({ runs: [], loading: false, error: null, refetch: vi.fn() });
    render(<DashboardPage />);

    expect(screen.getByTestId("linear-sync-dialog").dataset.open).toBe("false");
    await userEvent.click(screen.getByRole("button", { name: /sync from linear/i }));
    expect(screen.getByTestId("linear-sync-dialog").dataset.open).toBe("true");

    await userEvent.click(screen.getByText("close-dialog"));
    expect(screen.getByTestId("linear-sync-dialog").dataset.open).toBe("false");
  });

  it("calls refetch from RunsTable's onAction", async () => {
    const refetch = vi.fn();
    mockUseRuns.mockReturnValue({ runs: [], loading: false, error: null, refetch });
    render(<DashboardPage />);

    await userEvent.click(screen.getByText("trigger-action"));
    expect(refetch).toHaveBeenCalledOnce();
  });

  it("shows the ingest summary banner after onIngestComplete fires, and dismiss clears it", async () => {
    mockUseRuns.mockReturnValue({ runs: [], loading: false, error: null, refetch: vi.fn() });
    render(<DashboardPage />);

    expect(screen.queryByTestId("ingest-banner")).toBeNull();

    await userEvent.click(screen.getByText("fire-ingest-complete"));

    const banner = screen.getByTestId("ingest-banner");
    expect(banner.textContent).toContain("started:2");
    expect(banner.textContent).toContain("skipped:1");

    await userEvent.click(screen.getByText("dismiss"));
    expect(screen.queryByTestId("ingest-banner")).toBeNull();
  });

  it("auto-dismisses the ingest summary banner after the timeout", () => {
    vi.useFakeTimers();
    mockUseRuns.mockReturnValue({ runs: [], loading: false, error: null, refetch: vi.fn() });
    render(<DashboardPage />);

    act(() => {
      fireEvent.click(screen.getByText("fire-ingest-complete"));
    });
    expect(screen.getByTestId("ingest-banner")).toBeDefined();

    act(() => {
      vi.advanceTimersByTime(5000);
    });
    expect(screen.queryByTestId("ingest-banner")).toBeNull();
  });

  it("calls refetch when LinearSyncDialog reports a run was ingested", async () => {
    const refetch = vi.fn();
    mockUseRuns.mockReturnValue({ runs: [], loading: false, error: null, refetch });
    render(<DashboardPage />);

    await userEvent.click(screen.getByText("fire-ingested"));
    expect(refetch).toHaveBeenCalledOnce();
  });
});
