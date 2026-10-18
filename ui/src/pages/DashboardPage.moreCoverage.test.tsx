import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, act } from "@testing-library/react";
import type { Run } from "@/api/client.ts";

const useRunsMock = vi.fn();

vi.mock("@/hooks/useRuns.ts", () => ({
  useRuns: () => useRunsMock(),
}));

vi.mock("@/components/RunsTable.tsx", () => ({
  RunsTable: ({ runs }: { runs: Run[] }) => (
    <div data-testid="runs-table">
      {runs.map((r) => (
        <div key={r.id} data-testid="run-row">
          {r.id}:{r.state}
        </div>
      ))}
    </div>
  ),
}));

// Capture the onIngestComplete callback passed to LinearSyncDialog so tests
// can simulate a completed Linear sync without driving the real dialog.
let capturedOnIngestComplete: ((summary: { started: number; skipped: number }) => void) | null =
  null;

let capturedOnClose: (() => void) | null = null;

vi.mock("@/components/LinearSyncDialog.tsx", () => ({
  LinearSyncDialog: ({
    open,
    onClose,
    onIngestComplete,
  }: {
    open: boolean;
    onClose?: () => void;
    onIngestComplete?: (summary: { started: number; skipped: number }) => void;
  }) => {
    capturedOnIngestComplete = onIngestComplete ?? null;
    capturedOnClose = onClose ?? null;
    return <div data-testid="sync-dialog" data-open={open ? "true" : "false"} />;
  },
}));

// Use the real IngestSummaryBanner so we can assert on its rendered content.

import { DashboardPage } from "./DashboardPage.tsx";

function makeRun(overrides: Partial<Run>): Run {
  return {
    id: "run-1",
    linearIssueId: "issue-1",
    linearIssueIdentifier: "ENG-1",
    linearIssueDescription: null,
    linearIssueTitle: "Fix the bug",
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
    workingDirectory: "/tmp/repo",
    latestArtifactVersion: 1,
    createdAt: "2024-01-01T00:00:00.000Z",
    updatedAt: "2024-01-01T00:00:00.000Z",
    ...overrides,
  } as Run;
}

describe("DashboardPage – ingest summary banner lifecycle", () => {
  beforeEach(() => {
    useRunsMock.mockReset();
    capturedOnIngestComplete = null;
    useRunsMock.mockReturnValue({
      runs: [],
      loading: false,
      error: null,
      refetch: vi.fn(),
    });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("shows the ingest summary banner with started/skipped counts after a sync completes", () => {
    render(<DashboardPage />);
    expect(screen.queryByRole("status")).toBeNull();

    act(() => {
      capturedOnIngestComplete!({ started: 3, skipped: 1 });
    });

    const banner = screen.getByRole("status");
    expect(banner.textContent).toContain("Started 3 runs");
    expect(banner.textContent).toContain("skipped 1");
  });

  it("dismisses the banner when its dismiss button is clicked", () => {
    render(<DashboardPage />);

    act(() => {
      capturedOnIngestComplete!({ started: 1, skipped: 0 });
    });
    expect(screen.getByRole("status")).toBeDefined();

    act(() => {
      screen.getByRole("button", { name: "Dismiss" }).click();
    });

    expect(screen.queryByRole("status")).toBeNull();
  });

  it("auto-dismisses the banner after the timeout elapses", () => {
    vi.useFakeTimers();
    render(<DashboardPage />);

    act(() => {
      capturedOnIngestComplete!({ started: 2, skipped: 0 });
    });
    expect(screen.getByRole("status")).toBeDefined();

    act(() => {
      vi.advanceTimersByTime(5000);
    });

    expect(screen.queryByRole("status")).toBeNull();
  });

  it("accumulates per-category counts correctly when multiple runs share a category", () => {
    const runs = [
      makeRun({ id: "run-1", state: "Planning" }), // active
      makeRun({ id: "run-2", state: "Implementing" }), // also active
    ];
    useRunsMock.mockReturnValue({
      runs,
      loading: false,
      error: null,
      refetch: vi.fn(),
    });

    render(<DashboardPage />);

    // Total is 2, and the "Active" stat should also read 2 (not 1), proving
    // the counts reducer accumulates rather than only ever setting 1.
    const twos = screen.getAllByText("2");
    expect(twos.length).toBe(2); // Total and Active
  });

  it("counts a run with a state not present in the category map as 'idle'", () => {
    const runs = [makeRun({ id: "run-1", state: "SomeUnmappedState" })];
    useRunsMock.mockReturnValue({
      runs,
      loading: false,
      error: null,
      refetch: vi.fn(),
    });

    render(<DashboardPage />);

    // Total is 1; since "idle" has no dedicated stat tile, none of the
    // named categories (Active/Awaiting/Blocked/Done) should read 1.
    expect(screen.getByText("Total")).toBeDefined();
    const ones = screen.queryAllByText("1");
    // Only the "Total" tile shows 1; idle isn't one of the displayed stats.
    expect(ones.length).toBe(1);
  });

  it("closes the Linear sync dialog when its onClose callback fires", () => {
    render(<DashboardPage />);

    expect(screen.getByRole("button", { name: /Sync from Linear/i })).toBeDefined();
    act(() => {
      screen.getByRole("button", { name: /Sync from Linear/i }).click();
    });
    expect(screen.getByTestId("sync-dialog").getAttribute("data-open")).toBe("true");

    expect(capturedOnClose).not.toBeNull();
    act(() => {
      capturedOnClose!();
    });

    expect(screen.getByTestId("sync-dialog").getAttribute("data-open")).toBe("false");
  });
});
