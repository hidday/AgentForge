import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, act } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { Run } from "@/api/client.ts";

const mockUseRuns = vi.fn();
vi.mock("@/hooks/useRuns.ts", () => ({
  useRuns: () => mockUseRuns(),
}));

vi.mock("@/components/RunsTable.tsx", () => ({
  RunsTable: ({ runs }: { runs: Run[] }) => (
    <div data-testid="runs-table">{runs.map((r) => r.id).join(",")}</div>
  ),
}));

let capturedOnIngestComplete: ((s: { started: number; skipped: number }) => void) | null = null;

vi.mock("@/components/LinearSyncDialog.tsx", () => ({
  LinearSyncDialog: ({
    open,
    onIngestComplete,
  }: {
    open: boolean;
    onIngestComplete: (s: { started: number; skipped: number }) => void;
  }) => {
    capturedOnIngestComplete = onIngestComplete;
    return open ? <div data-testid="sync-dialog">sync dialog</div> : null;
  },
}));

vi.mock("@/components/IngestSummaryBanner.tsx", () => ({
  IngestSummaryBanner: ({ started, skipped }: { started: number; skipped: number }) => (
    <div data-testid="ingest-banner">
      started={started} skipped={skipped}
    </div>
  ),
}));

import { DashboardPage } from "./DashboardPage.tsx";

function run(id: string, state: string): Run {
  return { id, state } as unknown as Run;
}

describe("DashboardPage", () => {
  beforeEach(() => {
    mockUseRuns.mockReset();
    capturedOnIngestComplete = null;
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("shows a loading indicator while runs are loading", () => {
    mockUseRuns.mockReturnValue({ runs: [], loading: true, error: null, refetch: vi.fn() });
    render(<DashboardPage />);
    expect(screen.getByText(/Loading runs/i)).toBeDefined();
    expect(screen.queryByTestId("runs-table")).toBeNull();
  });

  it("shows an error message instead of the table when the fetch failed", () => {
    mockUseRuns.mockReturnValue({
      runs: [],
      loading: false,
      error: "network down",
      refetch: vi.fn(),
    });
    render(<DashboardPage />);
    expect(screen.getByText("network down")).toBeDefined();
    expect(screen.queryByTestId("runs-table")).toBeNull();
  });

  it("renders the stats bar counts derived from run states", () => {
    mockUseRuns.mockReturnValue({
      runs: [run("a", "Implementing"), run("b", "Done"), run("c", "AIBlocked")],
      loading: false,
      error: null,
      refetch: vi.fn(),
    });
    const { container } = render(<DashboardPage />);

    const statLabels = Array.from(
      container.querySelectorAll(".grid.grid-cols-5 > div"),
    ).map((el) => ({
      label: el.querySelector(".text-xs")!.textContent,
      value: el.querySelector(".text-2xl")!.textContent,
    }));

    expect(statLabels).toEqual([
      { label: "Total", value: "3" },
      { label: "Active", value: "1" },
      { label: "Awaiting", value: "0" },
      { label: "Blocked", value: "1" },
      { label: "Done", value: "1" },
    ]);
  });

  it("filters the rendered runs by state category when a filter button is clicked", async () => {
    mockUseRuns.mockReturnValue({
      runs: [run("a", "Implementing"), run("b", "Done")],
      loading: false,
      error: null,
      refetch: vi.fn(),
    });
    render(<DashboardPage />);

    expect(screen.getByTestId("runs-table").textContent).toBe("a,b");

    await userEvent.click(screen.getByRole("button", { name: "Done" }));
    expect(screen.getByTestId("runs-table").textContent).toBe("b");
  });

  it("opens the Linear sync dialog when 'Sync from Linear' is clicked", async () => {
    mockUseRuns.mockReturnValue({ runs: [], loading: false, error: null, refetch: vi.fn() });
    render(<DashboardPage />);

    expect(screen.queryByTestId("sync-dialog")).toBeNull();
    await userEvent.click(screen.getByRole("button", { name: /Sync from Linear/i }));
    expect(screen.getByTestId("sync-dialog")).toBeDefined();
  });

  it("shows the ingest summary banner after an ingest completes, and auto-dismisses it after 5s", () => {
    vi.useFakeTimers();
    mockUseRuns.mockReturnValue({ runs: [], loading: false, error: null, refetch: vi.fn() });
    render(<DashboardPage />);

    expect(screen.queryByTestId("ingest-banner")).toBeNull();

    act(() => {
      capturedOnIngestComplete!({ started: 3, skipped: 1 });
    });

    const banner = screen.getByTestId("ingest-banner");
    expect(banner.textContent).toContain("started=3");
    expect(banner.textContent).toContain("skipped=1");

    act(() => {
      vi.advanceTimersByTime(5000);
    });

    expect(screen.queryByTestId("ingest-banner")).toBeNull();
  });
});
