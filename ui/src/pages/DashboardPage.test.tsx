import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor, act, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

const useRunsMock = vi.fn();
vi.mock("@/hooks/useRuns.ts", () => ({
  useRuns: (...args: unknown[]) => useRunsMock(...args),
}));

vi.mock("@/components/RunsTable.tsx", () => ({
  RunsTable: ({ runs, onAction }: { runs: { id: string }[]; onAction?: () => void }) => (
    <div data-testid="runs-table">
      <span data-testid="runs-count">{runs.length}</span>
      <ul>
        {runs.map((r) => (
          <li key={r.id}>{r.id}</li>
        ))}
      </ul>
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
    onIngestComplete?: (s: { started: number; skipped: number }) => void;
  }) =>
    open ? (
      <div data-testid="sync-dialog">
        <button onClick={onClose}>close-dialog</button>
        <button onClick={onIngested}>fire-ingested</button>
        <button onClick={() => onIngestComplete?.({ started: 2, skipped: 1 })}>
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
    <div data-testid="ingest-banner">
      started {started}, skipped {skipped}
      <button onClick={onDismiss}>dismiss-banner</button>
    </div>
  ),
}));

import { DashboardPage } from "./DashboardPage.tsx";

const baseRuns = [
  { id: "r1", state: "Todo" },
  { id: "r2", state: "Planning" },
  { id: "r3", state: "AwaitingPlanApproval" },
  { id: "r4", state: "Done" },
  { id: "r5", state: "AIBlocked" },
];

function mockUseRuns(overrides: Partial<ReturnType<typeof defaultRunsResult>> = {}) {
  useRunsMock.mockReturnValue({ ...defaultRunsResult(), ...overrides });
}

function defaultRunsResult() {
  return {
    runs: baseRuns,
    loading: false,
    error: null as string | null,
    refetch: vi.fn(),
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
    mockUseRuns({ loading: true, runs: [] });
    render(<DashboardPage />);
    expect(screen.getByText(/Loading runs/i)).toBeDefined();
    expect(screen.queryByTestId("runs-table")).toBeNull();
  });

  it("shows an error message when the hook reports an error", () => {
    mockUseRuns({ error: "Failed to fetch runs" });
    render(<DashboardPage />);
    expect(screen.getByText("Failed to fetch runs")).toBeDefined();
    expect(screen.queryByTestId("runs-table")).toBeNull();
  });

  it("renders the runs table with all runs and correct stat counts by default", () => {
    mockUseRuns();
    const { container } = render(<DashboardPage />);
    expect(screen.getByTestId("runs-count").textContent).toBe("5");

    // Total stat reflects all 5 runs; each category stat reflects exactly
    // one run given baseRuns' single Todo/Planning/AwaitingPlanApproval/
    // Done/AIBlocked spread. Scope to the stats grid since "Blocked"/"Done"
    // labels are also repeated as filter button text.
    const statsGrid = container.querySelector(".grid-cols-5") as HTMLElement;
    const totalStat = within(statsGrid).getByText("Total").previousElementSibling;
    expect(totalStat?.textContent).toBe("5");
    for (const label of ["Active", "Awaiting", "Blocked", "Done"]) {
      const stat = within(statsGrid).getByText(label).previousElementSibling;
      expect(stat?.textContent).toBe("1");
    }
  });

  it("filters runs by category when a filter button is clicked", async () => {
    const user = userEvent.setup();
    mockUseRuns();
    render(<DashboardPage />);

    await user.click(screen.getByRole("button", { name: "Active" }));
    // Planning is the only "active" state in baseRuns
    expect(screen.getByTestId("runs-count").textContent).toBe("1");

    await user.click(screen.getByRole("button", { name: "Blocked" }));
    expect(screen.getByTestId("runs-count").textContent).toBe("1");

    await user.click(screen.getByRole("button", { name: "All" }));
    expect(screen.getByTestId("runs-count").textContent).toBe("5");
  });

  it("opens the LinearSyncDialog when 'Sync from Linear' is clicked", async () => {
    const user = userEvent.setup();
    mockUseRuns();
    render(<DashboardPage />);

    expect(screen.queryByTestId("sync-dialog")).toBeNull();
    await user.click(screen.getByRole("button", { name: /Sync from Linear/i }));
    expect(screen.getByTestId("sync-dialog")).toBeDefined();
  });

  it("closes the dialog via onClose", async () => {
    const user = userEvent.setup();
    mockUseRuns();
    render(<DashboardPage />);

    await user.click(screen.getByRole("button", { name: /Sync from Linear/i }));
    await user.click(screen.getByRole("button", { name: "close-dialog" }));
    expect(screen.queryByTestId("sync-dialog")).toBeNull();
  });

  it("calls refetch when the dialog reports onIngested", async () => {
    const user = userEvent.setup();
    const refetch = vi.fn();
    mockUseRuns({ refetch });
    render(<DashboardPage />);

    await user.click(screen.getByRole("button", { name: /Sync from Linear/i }));
    await user.click(screen.getByRole("button", { name: "fire-ingested" }));
    expect(refetch).toHaveBeenCalled();
  });

  it("calls refetch when a RunsTable action fires", async () => {
    const user = userEvent.setup();
    const refetch = vi.fn();
    mockUseRuns({ refetch });
    render(<DashboardPage />);

    await user.click(screen.getByRole("button", { name: "trigger-action" }));
    expect(refetch).toHaveBeenCalled();
  });

  it("shows the ingest summary banner after onIngestComplete and auto-dismisses it after 5s", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    mockUseRuns();
    render(<DashboardPage />);

    await user.click(screen.getByRole("button", { name: /Sync from Linear/i }));
    await user.click(screen.getByRole("button", { name: "fire-ingest-complete" }));

    expect(screen.getByTestId("ingest-banner").textContent).toContain("started 2");
    expect(screen.getByTestId("ingest-banner").textContent).toContain("skipped 1");

    await act(async () => {
      vi.advanceTimersByTime(5000);
    });

    await waitFor(() => expect(screen.queryByTestId("ingest-banner")).toBeNull());
  });

  it("dismisses the ingest banner manually via its onDismiss handler", async () => {
    const user = userEvent.setup();
    mockUseRuns();
    render(<DashboardPage />);

    await user.click(screen.getByRole("button", { name: /Sync from Linear/i }));
    await user.click(screen.getByRole("button", { name: "fire-ingest-complete" }));
    expect(screen.getByTestId("ingest-banner")).toBeDefined();

    await user.click(screen.getByRole("button", { name: "dismiss-banner" }));
    expect(screen.queryByTestId("ingest-banner")).toBeNull();
  });

  it("renders zero stat counts gracefully with an empty runs list", () => {
    mockUseRuns({ runs: [] });
    render(<DashboardPage />);
    expect(screen.getByTestId("runs-count").textContent).toBe("0");
  });

  it("counts a run with an unrecognized state as idle rather than throwing", () => {
    mockUseRuns({ runs: [...baseRuns, { id: "r6", state: "SomeUnknownState" }] });
    const { container } = render(<DashboardPage />);
    // Idle runs aren't shown in the stats row at all (no "idle" stat tile),
    // but the run should still be counted in the total and not blow up the
    // reduce — this exercises the `?? "idle"` fallback branch.
    expect(screen.getByTestId("runs-count").textContent).toBe("6");
    const statsGrid = container.querySelector(".grid-cols-5") as HTMLElement;
    const totalStat = within(statsGrid).getByText("Total").previousElementSibling;
    expect(totalStat?.textContent).toBe("6");
  });
});
