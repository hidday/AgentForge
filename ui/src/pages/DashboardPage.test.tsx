import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, act } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import type { Run } from "@/api/client.ts";

const mockUseRuns = vi.fn();
vi.mock("@/hooks/useRuns.ts", () => ({
  useRuns: (...args: unknown[]) => mockUseRuns(...args),
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
  }) =>
    open ? (
      <div data-testid="sync-dialog">
        <button onClick={onClose}>close-sync</button>
        <button onClick={() => onIngestComplete({ started: 2, skipped: 1 })}>
          finish-ingest
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
      Started {started}, skipped {skipped}
      <button onClick={onDismiss}>dismiss-banner</button>
    </div>
  ),
}));

import { DashboardPage } from "./DashboardPage.tsx";

function makeRun(overrides: Partial<Run> = {}): Run {
  return {
    id: "run-1",
    linearIssueId: "issue-1",
    linearIssueIdentifier: "ENG-1",
    linearIssueDescription: null,
    linearIssueTitle: "Fix bug",
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
    latestArtifactVersion: 0,
    createdAt: "2026-01-01T00:00:00Z",
    updatedAt: "2026-01-01T00:00:00Z",
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

describe("DashboardPage", () => {
  beforeEach(() => {
    mockUseRuns.mockReset();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("shows a loading indicator while runs are loading", () => {
    mockUseRuns.mockReturnValue({ runs: [], loading: true, error: null, refetch: vi.fn() });
    renderPage();
    expect(screen.getByText("Loading runs...")).toBeDefined();
    expect(screen.queryByTestId("runs-table")).toBeNull();
  });

  it("shows an error message when the hook reports an error", () => {
    mockUseRuns.mockReturnValue({
      runs: [],
      loading: false,
      error: "Failed to fetch runs",
      refetch: vi.fn(),
    });
    renderPage();
    expect(screen.getByText("Failed to fetch runs")).toBeDefined();
  });

  it("renders the runs table and stats bar once loaded", () => {
    const runs = [
      makeRun({ id: "r1", state: "Planning" }),
      makeRun({ id: "r2", state: "Done" }),
      makeRun({ id: "r3", state: "AIBlocked" }),
      makeRun({ id: "r4", state: "SomeUnmappedState" }),
    ];
    mockUseRuns.mockReturnValue({ runs, loading: false, error: null, refetch: vi.fn() });
    renderPage();

    expect(screen.getByTestId("runs-table").textContent).toBe("r1,r2,r3,r4");
    // Total stat (an unmapped state falls back to the "idle" bucket rather than crashing).
    expect(screen.getByText("4")).toBeDefined();
  });

  it("filters runs by category when a filter button is clicked", async () => {
    const runs = [
      makeRun({ id: "r1", state: "Planning" }),
      makeRun({ id: "r2", state: "Done" }),
    ];
    mockUseRuns.mockReturnValue({ runs, loading: false, error: null, refetch: vi.fn() });
    renderPage();

    await userEvent.click(screen.getByRole("button", { name: "Done" }));
    expect(screen.getByTestId("runs-table").textContent).toBe("r2");

    await userEvent.click(screen.getByRole("button", { name: "All" }));
    expect(screen.getByTestId("runs-table").textContent).toBe("r1,r2");
  });

  it("opens and closes the Linear sync dialog", async () => {
    mockUseRuns.mockReturnValue({ runs: [], loading: false, error: null, refetch: vi.fn() });
    renderPage();

    expect(screen.queryByTestId("sync-dialog")).toBeNull();
    await userEvent.click(screen.getByRole("button", { name: /Sync from Linear/i }));
    expect(screen.getByTestId("sync-dialog")).toBeDefined();

    await userEvent.click(screen.getByText("close-sync"));
    expect(screen.queryByTestId("sync-dialog")).toBeNull();
  });

  it("shows the ingest summary banner after an ingest completes and dismisses it manually", async () => {
    const refetch = vi.fn();
    mockUseRuns.mockReturnValue({ runs: [], loading: false, error: null, refetch });
    renderPage();

    await userEvent.click(screen.getByRole("button", { name: /Sync from Linear/i }));
    await userEvent.click(screen.getByText("finish-ingest"));

    expect(screen.getByTestId("ingest-banner").textContent).toContain("Started 2, skipped 1");

    await userEvent.click(screen.getByText("dismiss-banner"));
    expect(screen.queryByTestId("ingest-banner")).toBeNull();
  });

  it("auto-dismisses the ingest summary banner after the timeout", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    mockUseRuns.mockReturnValue({ runs: [], loading: false, error: null, refetch: vi.fn() });
    renderPage();

    await user.click(screen.getByRole("button", { name: /Sync from Linear/i }));
    await user.click(screen.getByText("finish-ingest"));
    expect(screen.getByTestId("ingest-banner")).toBeDefined();

    act(() => {
      vi.advanceTimersByTime(5000);
    });
    expect(screen.queryByTestId("ingest-banner")).toBeNull();
  });
});
